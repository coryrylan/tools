import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from '@earendil-works/pi-coding-agent';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { getErrorMessage } from './hooks-config.js';
import type { HookCommand, HookEventName, HookGroup, HookRuntime } from './hooks-config.js';

/** JSON payload written to a hook command's stdin: Claude-Code field names plus snake/camel workspace-root aliases. */
export interface HookPayload extends Record<string, unknown> {
  hook_event_name: HookEventName;
  cwd: string;
  session_id: string;
  transcript_path?: string | undefined;
  workspace_root?: string | undefined;
  workspaceRoot?: string | undefined;
  project_dir?: string | undefined;
  projectDir?: string | undefined;
}

/** Options for {@link createBasePayload}. */
export interface CreateBasePayloadOptions {
  eventName: HookEventName;
  ctx: ExtensionContext;
  runtime: HookRuntime;
  extra?: Record<string, unknown> | undefined;
}

export interface RunHookOptions {
  eventName: HookEventName;
  matcherTarget: string;
  payload: HookPayload;
  runtime: HookRuntime;
  ctx: ExtensionContext;
  signal?: AbortSignal | undefined;
  stopAfterBlockingPreHook?: boolean | undefined;
}

export interface HookCommandResult {
  eventName: HookEventName;
  hook: HookCommand;
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

/**
 * Runs every command hook whose group matches `options.matcherTarget`, in
 * manifest order, toggling the status line for the duration. With
 * `stopAfterBlockingPreHook` (PreToolUse only), stops at the first
 * blocking result.
 */
export async function runMatchingHooks(options: RunHookOptions): Promise<HookCommandResult[]> {
  const results: HookCommandResult[] = [];

  try {
    for (const hook of (options.runtime.hooks[options.eventName] ?? [])
      .filter(group => matchesHookGroup(group, options.matcherTarget))
      .flatMap(group => group.hooks)) {
      setHookStatus(hook.statusMessage, options.ctx);
      const result = await runCommandHook(hook, options);
      results.push(result);
      if (options.stopAfterBlockingPreHook && isBlockingPreToolResult(result)) return results;
    }

    return results;
  } finally {
    setHookStatus(undefined, options.ctx);
  }
}

function setHookStatus(message: string | undefined, ctx: ExtensionContext): void {
  if (ctx.hasUI) ctx.ui.setStatus('agents-hooks', message);
}

/** True when `group.matcher` is absent (matches everything) or matches `target`; falls back to an exact-string match when the matcher isn't valid regex. */
export function matchesHookGroup(group: HookGroup, target: string): boolean {
  if (!group.matcher) return true;

  try {
    return new RegExp(group.matcher).test(target);
  } catch {
    return group.matcher === target;
  }
}

interface OutputChunkCollector {
  stdoutChunks: Buffer[];
  stderrChunks: Buffer[];
}

interface HookRunState {
  settled: boolean;
  timedOut: boolean;
  aborted: boolean;
}

function buildHookProcessEnv(cwd: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AGENTS_PROJECT_DIR: cwd,
    CODEX_PROJECT_DIR: cwd,
    CODEX_WORKSPACE_ROOT: cwd,
    WORKSPACE_ROOT: cwd,
    PROJECT_DIR: cwd
  };
}

function spawnHookProcess(hook: HookCommand, cwd: string): ChildProcessWithoutNullStreams {
  return spawn('bash', ['-lc', hook.command], {
    cwd,
    env: buildHookProcessEnv(cwd),
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function collectHookProcessOutput(child: ChildProcessWithoutNullStreams): OutputChunkCollector {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
  return { stdoutChunks, stderrChunks };
}

interface WireHookLifecycleOptions {
  child: ChildProcessWithoutNullStreams;
  hook: HookCommand;
  signal: AbortSignal | undefined;
  state: HookRunState;
}

interface HookLifecycleHandles {
  timeout: NodeJS.Timeout;
  abortListener: () => void;
}

/** Wires the timeout and abort-signal termination paths shared by every hook run, flagging `state` before killing the process tree. */
function wireHookTimeoutAndAbort(options: WireHookLifecycleOptions): HookLifecycleHandles {
  const terminate = () => {
    terminateChildProcess(options.child);
  };
  const timeout = setTimeout(() => {
    options.state.timedOut = true;
    terminate();
  }, options.hook.timeoutSeconds * 1000);
  const abortListener = () => {
    options.state.aborted = true;
    terminate();
  };

  options.signal?.addEventListener('abort', abortListener, { once: true });
  return { timeout, abortListener };
}

interface CreateHookFinishHandlerOptions {
  eventName: HookEventName;
  hook: HookCommand;
  state: HookRunState;
  handles: HookLifecycleHandles;
  signal: AbortSignal | undefined;
  output: OutputChunkCollector;
  resolveResult: (result: HookCommandResult) => void;
}

/** Builds the child-process `close`/`error` callback: settles exactly once, tears down the timeout/abort wiring, and resolves the run result. */
function createHookFinishHandler(options: CreateHookFinishHandlerOptions): (code: number) => void {
  return code => {
    if (options.state.settled) return;
    options.state.settled = true;
    clearTimeout(options.handles.timeout);
    options.signal?.removeEventListener('abort', options.handles.abortListener);
    options.resolveResult({
      eventName: options.eventName,
      hook: options.hook,
      code,
      stdout: Buffer.concat(options.output.stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(options.output.stderrChunks).toString('utf8'),
      timedOut: options.state.timedOut,
      aborted: options.state.aborted
    });
  };
}

/**
 * Runs a single command hook: spawns `bash -lc <command>`, writes the JSON
 * payload to stdin, and captures stdout/stderr/exit code. Never rejects -
 * a spawn error resolves with `code: 1` and the error message on stderr.
 */
async function runCommandHook(hook: HookCommand, options: RunHookOptions): Promise<HookCommandResult> {
  const cwd = options.runtime.projectRoot ?? options.ctx.cwd;

  return new Promise<HookCommandResult>(resolveResult => {
    const state: HookRunState = { settled: false, timedOut: false, aborted: false };
    const child = spawnHookProcess(hook, cwd);
    const output = collectHookProcessOutput(child);
    const handles = wireHookTimeoutAndAbort({ child, hook, signal: options.signal, state });
    const finish = createHookFinishHandler({
      eventName: options.eventName,
      hook,
      state,
      handles,
      signal: options.signal,
      output,
      resolveResult
    });

    child.on('error', error => {
      output.stderrChunks.push(Buffer.from(getErrorMessage(error)));
      finish(1);
    });
    child.on('close', code => {
      finish(code ?? 1);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(options.payload));
  });
}

function terminateChildProcess(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (!pid || process.platform === 'win32') {
    child.kill('SIGTERM');
    return;
  }

  const killTree = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      child.kill(signal);
    }
  };

  killTree('SIGTERM');
  setTimeout(() => {
    if (!child.killed) killTree('SIGKILL');
  }, 1_000).unref();
}

/** Builds the JSON payload written to a hook's stdin: Claude-Code field names plus snake/camel workspace-root aliases so both naming conventions work. */
export function createBasePayload(options: CreateBasePayloadOptions): HookPayload {
  const { eventName, ctx, runtime, extra = {} } = options;
  const sessionFile = ctx.sessionManager.getSessionFile();
  const projectRoot = runtime.projectRoot;

  return {
    hook_event_name: eventName,
    cwd: ctx.cwd,
    session_id: ctx.sessionManager.getSessionId(),
    ...(sessionFile ? { transcript_path: sessionFile } : {}),
    ...(projectRoot
      ? {
          workspace_root: projectRoot,
          workspaceRoot: projectRoot,
          project_dir: projectRoot,
          projectDir: projectRoot
        }
      : {}),
    ...extra
  };
}

/** Claude-Code hook matchers use PascalCase tool names (`Bash`, `Read`); pi's tool-call events use lowercase. */
export function getHookToolName(toolName: string): string {
  return `${toolName.charAt(0).toUpperCase()}${toolName.slice(1)}`;
}

export function isBlockingPreToolResult(result: HookCommandResult): boolean {
  return result.code === 2 || result.timedOut || result.aborted;
}

export function isFailedHookResult(result: HookCommandResult): boolean {
  return result.code !== 0 || result.timedOut || result.aborted;
}

export function formatHookFeedback(eventName: HookEventName, results: HookCommandResult[]): string {
  return `${eventName} hook feedback:\n\n${results.map(formatHookResult).join('\n\n')}`;
}

function formatHookResult(result: HookCommandResult): string {
  const output = formatHookOutput(result);
  const status = result.timedOut
    ? `timed out after ${String(result.hook.timeoutSeconds)}s`
    : result.aborted
      ? 'aborted'
      : `exited ${String(result.code)}`;
  const header = `$ ${result.hook.command}\n${status}`;

  return [header, output].filter(Boolean).join('\n\n');
}

/** Formats a hook's captured stdout+stderr for feedback text, appending a truncation notice (line/byte counts) when the combined output exceeded the tool-output limits. */
export function formatHookOutput(result: HookCommandResult): string {
  const raw = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join('\n');
  if (!raw) {
    return '';
  }

  const truncation = truncateTail(raw, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES
  });

  if (!truncation.truncated) {
    return truncation.content;
  }

  return `${truncation.content}\n\n[Hook output truncated: ${String(truncation.outputLines)} of ${String(truncation.totalLines)} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
}
