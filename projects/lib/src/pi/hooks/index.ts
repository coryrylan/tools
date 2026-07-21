/**
 * Claude-Code-style lifecycle hooks loaded from a project's
 * `.agents/hooks.json`: SessionStart, PreToolUse, PostToolUse, and Stop
 * events run matching `type: "command"` hooks via `bash -lc`, with the
 * event payload written to the child's stdin as JSON. A PreToolUse hook
 * exiting with code 2 blocks the tool call; a failing Stop hook queues a
 * single follow-up user message asking the agent to fix and re-check.
 *
 * @see https://docs.claude.com/en/docs/claude-code/hooks - the hook
 * contract (event names, matchers, exit-code semantics) this extension
 * mirrors, so an existing Claude Code hooks config works unmodified.
 */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { isAbsolute, relative } from 'node:path';
import {
  asRecord,
  getErrorMessage,
  isDefined,
  loadHookRuntime,
  HOOK_EVENT_NAMES,
  type HookEventName,
  type HookGroupsByEvent,
  type HookRuntime
} from './hooks-config.js';
import {
  createBasePayload,
  formatHookFeedback,
  formatHookOutput,
  getHookToolName,
  isBlockingPreToolResult,
  isFailedHookResult,
  runMatchingHooks,
  type HookCommandResult
} from './hook-runner.js';

interface HookExtensionState {
  runtime: HookRuntime;
  stopHookFollowUpActive: boolean;
}

/** Registers the SessionStart/PreToolUse/PostToolUse/Stop lifecycle handlers and the `/hooks` command. */
export default function agentsHooksExtension(pi: ExtensionAPI): void {
  const state: HookExtensionState = { runtime: { hooks: {} }, stopHookFollowUpActive: false };

  registerSessionStartHandler(pi, state);
  registerPreToolUseHandler(pi, state);
  registerPostToolUseHandler(pi, state);
  registerStopHandler(pi, state);
  registerHooksCommand(pi, state);
}

function registerSessionStartHandler(pi: ExtensionAPI, state: HookExtensionState): void {
  pi.on('session_start', async (event, ctx) => {
    state.runtime = await loadHookRuntime(ctx.cwd);
    notifyLoadResult(state.runtime, ctx);

    const results = await runMatchingHooks({
      eventName: 'SessionStart',
      matcherTarget: event.reason,
      payload: createBasePayload({
        eventName: 'SessionStart',
        ctx,
        runtime: state.runtime,
        extra: { source: event.reason, reason: event.reason }
      }),
      runtime: state.runtime,
      ctx
    });
    notifySuccessfulOutput(results, ctx);
    notifyFailures('SessionStart', results, ctx);
  });
}

function registerPreToolUseHandler(pi: ExtensionAPI, state: HookExtensionState): void {
  pi.on('tool_call', async (event, ctx) => {
    const toolName = getHookToolName(event.toolName);
    const results = await runMatchingHooks({
      eventName: 'PreToolUse',
      matcherTarget: toolName,
      payload: createBasePayload({
        eventName: 'PreToolUse',
        ctx,
        runtime: state.runtime,
        extra: {
          tool_name: toolName,
          toolName,
          tool_call_id: event.toolCallId,
          tool_input: event.input
        }
      }),
      runtime: state.runtime,
      ctx,
      signal: ctx.signal,
      stopAfterBlockingPreHook: true
    });
    const blockingResult = results.find(isBlockingPreToolResult);

    if (!blockingResult) {
      notifyFailures('PreToolUse', results, ctx);
      return undefined;
    }

    return {
      block: true,
      reason: formatHookFeedback('PreToolUse', [blockingResult])
    };
  });
}

function registerPostToolUseHandler(pi: ExtensionAPI, state: HookExtensionState): void {
  pi.on('tool_result', async (event, ctx) => {
    const toolName = getHookToolName(event.toolName);
    const results = await runMatchingHooks({
      eventName: 'PostToolUse',
      matcherTarget: toolName,
      payload: createBasePayload({
        eventName: 'PostToolUse',
        ctx,
        runtime: state.runtime,
        extra: {
          tool_name: toolName,
          toolName,
          tool_call_id: event.toolCallId,
          tool_input: event.input,
          tool_response: {
            content: event.content,
            details: event.details,
            is_error: event.isError
          }
        }
      }),
      runtime: state.runtime,
      ctx,
      signal: ctx.signal
    });
    const failures = results.filter(isFailedHookResult);

    if (failures.length === 0) {
      return undefined;
    }

    return {
      content: [
        ...event.content,
        {
          type: 'text' as const,
          text: formatHookFeedback('PostToolUse', failures)
        }
      ],
      isError: true
    };
  });
}

function registerStopHandler(pi: ExtensionAPI, state: HookExtensionState): void {
  pi.on('agent_end', async (event, ctx) => {
    const results = await runMatchingHooks({
      eventName: 'Stop',
      matcherTarget: 'Stop',
      payload: createBasePayload({
        eventName: 'Stop',
        ctx,
        runtime: state.runtime,
        extra: {
          stop_hook_active: state.stopHookFollowUpActive,
          last_assistant_message: getLastAssistantMessageText(event.messages)
        }
      }),
      runtime: state.runtime,
      ctx,
      signal: ctx.signal
    });
    const failures = results.filter(isFailedHookResult);

    if (failures.length === 0) {
      state.stopHookFollowUpActive = false;
      return;
    }

    handleStopHookFailures({ pi, state, feedback: formatHookFeedback('Stop', failures), ctx });
  });
}

interface HandleStopHookFailuresOptions {
  pi: ExtensionAPI;
  state: HookExtensionState;
  feedback: string;
  ctx: ExtensionContext;
}

/** Notifies (and clears the guard) when a follow-up Stop hook fails again; otherwise queues the one-time follow-up message asking the agent to fix and re-check. */
function handleStopHookFailures(options: HandleStopHookFailuresOptions): void {
  const { pi, state, feedback, ctx } = options;

  if (state.stopHookFollowUpActive) {
    notifyFailure(feedback, ctx);
    state.stopHookFollowUpActive = false;
    return;
  }

  state.stopHookFollowUpActive = true;
  try {
    pi.sendUserMessage(`Stop hooks failed. Fix the failures and run the relevant checks again.\n\n${feedback}`, {
      deliverAs: 'followUp'
    });
  } catch (error) {
    state.stopHookFollowUpActive = false;
    notifyFailure(`${feedback}\n\nCould not queue stop-hook follow-up: ${getErrorMessage(error)}`, ctx);
  }
}

function registerHooksCommand(pi: ExtensionAPI, state: HookExtensionState): void {
  pi.registerCommand('hooks', {
    description: 'Show or reload project .agents/hooks.json hooks',
    handler: async (args, ctx) => {
      if (args.trim() === 'reload') {
        state.runtime = await loadHookRuntime(ctx.cwd);
      }
      if (ctx.hasUI) {
        ctx.ui.notify(formatRuntimeSummary(state.runtime, ctx.cwd), state.runtime.loadError ? 'warning' : 'info');
      }
    }
  });
}

function notifyLoadResult(runtime: HookRuntime, ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  if (runtime.loadError) {
    ctx.ui.notify(`Failed to load ${runtime.hooksFile ?? '<unknown file>'}: ${runtime.loadError}`, 'warning');
    return;
  }

  const hookCount = countHooks(runtime.hooks);
  if (runtime.hooksFile && hookCount > 0) {
    ctx.ui.notify(`Loaded ${String(hookCount)} hook(s) from ${formatDisplayPath(runtime.hooksFile, ctx.cwd)}`, 'info');
  }
}

function notifySuccessfulOutput(results: HookCommandResult[], ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  results
    .filter(result => result.code === 0)
    .map(formatHookOutput)
    .filter(Boolean)
    .forEach(output => {
      ctx.ui.notify(output, 'info');
    });
}

function notifyFailures(eventName: HookEventName, results: HookCommandResult[], ctx: ExtensionContext): void {
  const failures = results.filter(isFailedHookResult);
  if (failures.length > 0) notifyFailure(formatHookFeedback(eventName, failures), ctx);
}

function notifyFailure(feedback: string, ctx: ExtensionContext): void {
  if (ctx.hasUI) ctx.ui.notify(feedback, 'warning');
}

function formatRuntimeSummary(runtime: HookRuntime, cwd: string): string {
  if (!runtime.hooksFile) return 'No .agents/hooks.json found for this working directory.';

  const path = formatDisplayPath(runtime.hooksFile, cwd);
  return runtime.loadError
    ? `${path}: failed to load (${runtime.loadError})`
    : `${path}: ${String(countHooks(runtime.hooks))} hook(s) loaded.`;
}

function countHooks(hooks: HookGroupsByEvent): number {
  return HOOK_EVENT_NAMES.flatMap(eventName => hooks[eventName] ?? []).reduce(
    (count, group) => count + group.hooks.length,
    0
  );
}

function formatDisplayPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path;

  const relativePath = relative(cwd, path);
  return relativePath.startsWith('..') ? path : relativePath || '.';
}

function getLastAssistantMessageText(messages: readonly { role: string; content?: unknown }[]): string {
  const assistantMessage = [...messages].reverse().find(message => message.role === 'assistant');
  if (!assistantMessage || !Array.isArray(assistantMessage.content)) {
    return '';
  }

  return assistantMessage.content
    .map(asRecord)
    .filter(isDefined)
    .filter(part => part['type'] === 'text' && typeof part['text'] === 'string')
    .map(part => String(part['text']))
    .join('\n');
}
