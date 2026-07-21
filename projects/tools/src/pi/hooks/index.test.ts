import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent
} from '@earendil-works/pi-coding-agent';
import agentsHooksExtension from './index.js';

const scratchRoot = resolve(import.meta.dirname, '../../../node_modules/.cache/coryrylan-tools-tests');

// `ToolResultEventResult` is defined in @earendil-works/pi-coding-agent's
// extension-types module but is not re-exported from the package root, so
// this test-only shape mirrors it structurally instead of importing it.
interface FakeToolResultEventResult {
  content?: ToolResultEvent['content'];
  details?: unknown;
  isError?: boolean;
}

type SessionStartHandler = (event: { type: 'session_start'; reason: string }, ctx: ExtensionContext) => Promise<void>;
type ToolCallHandler = (event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallEventResult | undefined>;
type ToolResultHandler = (
  event: ToolResultEvent,
  ctx: ExtensionContext
) => Promise<FakeToolResultEventResult | undefined>;
type AgentEndHandler = (event: AgentEndEvent, ctx: ExtensionContext) => Promise<void>;
type HooksCommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

interface FakePi {
  pi: ExtensionAPI;
  sessionStart: SessionStartHandler;
  toolCall: ToolCallHandler;
  toolResult: ToolResultHandler;
  agentEnd: AgentEndHandler;
  hooksCommand: HooksCommandHandler;
  sentUserMessages: Array<{ content: string; deliverAs?: string | undefined }>;
}

/**
 * Minimal fake `ExtensionAPI` that captures the handlers `agentsHooksExtension`
 * registers for each event, cast narrowly rather than satisfying the full
 * interface - only `on`, `registerCommand`, and `sendUserMessage` are called.
 * When `sendUserMessageThrows` is set, `sendUserMessage` throws instead of
 * recording the message, exercising the follow-up queue's catch branch.
 */
function createFakePi(options: { sendUserMessageThrows?: boolean } = {}): FakePi {
  const handlers: Record<string, unknown> = {};
  const sentUserMessages: Array<{ content: string; deliverAs?: string | undefined }> = [];
  let hooksCommand: HooksCommandHandler = () => Promise.resolve();

  const fakePi = {
    on: (event: string, handler: unknown) => {
      handlers[event] = handler;
    },
    registerCommand: (_name: string, commandOptions: { handler: HooksCommandHandler }) => {
      hooksCommand = commandOptions.handler;
    },
    sendUserMessage: (content: string, sendOptions?: { deliverAs?: string }) => {
      if (options.sendUserMessageThrows) throw new Error('Send-user-message failed');
      sentUserMessages.push({ content, deliverAs: sendOptions?.deliverAs });
    }
  };

  agentsHooksExtension(fakePi as unknown as ExtensionAPI);

  return {
    pi: fakePi as unknown as ExtensionAPI,
    sessionStart: handlers['session_start'] as SessionStartHandler,
    toolCall: handlers['tool_call'] as ToolCallHandler,
    toolResult: handlers['tool_result'] as ToolResultHandler,
    agentEnd: handlers['agent_end'] as AgentEndHandler,
    hooksCommand: (...args) => hooksCommand(...args),
    sentUserMessages
  };
}

interface FakeContextOptions {
  cwd: string;
  hasUI?: boolean;
}

/** Minimal fake `ExtensionContext`/`ExtensionCommandContext`, cast narrowly - only the fields the extension reads are provided. */
function createFakeContext(options: FakeContextOptions): ExtensionContext & { notifications: Array<[string, string]> } {
  const notifications: Array<[string, string]> = [];
  return {
    cwd: options.cwd,
    hasUI: options.hasUI ?? true,
    signal: undefined,
    sessionManager: {
      getSessionId: () => 'session-1',
      getSessionFile: () => undefined
    },
    ui: {
      notify: (message: string, type = 'info') => notifications.push([message, type]),
      setStatus: () => undefined
    },
    notifications
  } as unknown as ExtensionContext & { notifications: Array<[string, string]> };
}

function writeHooksManifest(projectRoot: string, manifest: unknown): void {
  mkdirSync(join(projectRoot, '.agents'), { recursive: true });
  writeFileSync(join(projectRoot, '.agents/hooks.json'), JSON.stringify(manifest));
}

function buildToolCallEvent(overrides: Partial<ToolCallEvent> = {}): ToolCallEvent {
  return { type: 'tool_call', toolCallId: 'call-1', toolName: 'bash', input: {}, ...overrides };
}

function buildToolResultEvent(overrides: Partial<ToolResultEvent> = {}): ToolResultEvent {
  return {
    type: 'tool_result',
    toolCallId: 'call-1',
    toolName: 'bash',
    input: {},
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    details: undefined,
    ...overrides
  };
}

describe('agentsHooksExtension', () => {
  let projectRoot: string;

  beforeEach(() => {
    mkdirSync(scratchRoot, { recursive: true });
    projectRoot = mkdtempSync(join(scratchRoot, 'hooks-extension-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('should register exactly one handler per lifecycle event and the hooks command', () => {
    const { sessionStart, toolCall, toolResult, agentEnd, hooksCommand } = createFakePi();

    expect(sessionStart).toBeTypeOf('function');
    expect(toolCall).toBeTypeOf('function');
    expect(toolResult).toBeTypeOf('function');
    expect(agentEnd).toBeTypeOf('function');
    expect(hooksCommand).toBeTypeOf('function');
  });

  describe('tool_call (PreToolUse)', () => {
    it('should block the tool call and return the hook feedback when a matching hook exits 2', async () => {
      writeHooksManifest(projectRoot, {
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo denied; exit 2' }] }] }
      });
      const { sessionStart, toolCall } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await sessionStart({ type: 'session_start', reason: 'startup' }, ctx);

      const result = await toolCall(buildToolCallEvent(), ctx);

      expect(result?.block).toBe(true);
      expect(result?.reason).toContain('denied');
      expect(result?.reason).toContain('exited 2');
    });

    it('should not block the tool call when the matching hook exits 0', async () => {
      writeHooksManifest(projectRoot, {
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo ok' }] }] }
      });
      const { sessionStart, toolCall } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await sessionStart({ type: 'session_start', reason: 'startup' }, ctx);

      const result = await toolCall(buildToolCallEvent(), ctx);

      expect(result).toBeUndefined();
    });

    it('should not block the tool call when no hook matcher matches the tool', async () => {
      writeHooksManifest(projectRoot, {
        hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'exit 2' }] }] }
      });
      const { sessionStart, toolCall } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await sessionStart({ type: 'session_start', reason: 'startup' }, ctx);

      const result = await toolCall(buildToolCallEvent({ toolName: 'bash' }), ctx);

      expect(result).toBeUndefined();
    });
  });

  describe('tool_result (PostToolUse)', () => {
    it('should append hook feedback and set isError when a matching hook fails', async () => {
      writeHooksManifest(projectRoot, {
        hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo lint-failed; exit 1' }] }] }
      });
      const { sessionStart, toolResult } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await sessionStart({ type: 'session_start', reason: 'startup' }, ctx);

      const result = await toolResult(buildToolResultEvent(), ctx);

      expect(result?.isError).toBe(true);
      expect(result?.content).toHaveLength(2);
      const feedbackPart = result?.content?.[1];
      expect(feedbackPart && 'text' in feedbackPart ? feedbackPart.text : '').toContain('lint-failed');
    });

    it('should return undefined when every matching hook succeeds', async () => {
      writeHooksManifest(projectRoot, {
        hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'exit 0' }] }] }
      });
      const { sessionStart, toolResult } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await sessionStart({ type: 'session_start', reason: 'startup' }, ctx);

      const result = await toolResult(buildToolResultEvent(), ctx);

      expect(result).toBeUndefined();
    });
  });

  describe('agent_end (Stop)', () => {
    it('should queue exactly one follow-up user message the first time the Stop hook fails', async () => {
      writeHooksManifest(projectRoot, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'exit 1' }] }] } });
      const { sessionStart, agentEnd, sentUserMessages } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await sessionStart({ type: 'session_start', reason: 'startup' }, ctx);

      await agentEnd({ type: 'agent_end', messages: [] }, ctx);

      expect(sentUserMessages).toHaveLength(1);
      expect(sentUserMessages[0]?.deliverAs).toBe('followUp');
      expect(sentUserMessages[0]?.content).toContain('Stop hooks failed');
    });

    it('should notify with the failure when sendUserMessage throws while queueing the follow-up', async () => {
      writeHooksManifest(projectRoot, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'exit 1' }] }] } });
      const { sessionStart, agentEnd, sentUserMessages } = createFakePi({ sendUserMessageThrows: true });
      const ctx = createFakeContext({ cwd: projectRoot });
      await sessionStart({ type: 'session_start', reason: 'startup' }, ctx);

      await agentEnd({ type: 'agent_end', messages: [] }, ctx);

      expect(sentUserMessages).toEqual([]);
      expect(ctx.notifications.some(([message]) => message.includes('Could not queue stop-hook follow-up'))).toBe(true);
    });

    it('should notify instead of sending a second follow-up when the Stop hook fails again', async () => {
      writeHooksManifest(projectRoot, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'exit 1' }] }] } });
      const { sessionStart, agentEnd, sentUserMessages } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await agentEnd({ type: 'agent_end', messages: [] }, ctx);

      await agentEnd({ type: 'agent_end', messages: [] }, ctx);

      expect(sentUserMessages).toHaveLength(1);
      expect(ctx.notifications.some(([message]) => message.includes('Stop hook feedback'))).toBe(true);
    });

    it('should queue a new follow-up on a third run after the guard reset from a second failure', async () => {
      writeHooksManifest(projectRoot, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'exit 1' }] }] } });
      const { sessionStart, agentEnd, sentUserMessages } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await agentEnd({ type: 'agent_end', messages: [] }, ctx);
      await agentEnd({ type: 'agent_end', messages: [] }, ctx);

      await agentEnd({ type: 'agent_end', messages: [] }, ctx);

      expect(sentUserMessages).toHaveLength(2);
    });

    it('should not send a follow-up message when the Stop hook succeeds', async () => {
      writeHooksManifest(projectRoot, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'exit 0' }] }] } });
      const { sessionStart, agentEnd, sentUserMessages } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await sessionStart({ type: 'session_start', reason: 'startup' }, ctx);

      await agentEnd({ type: 'agent_end', messages: [] }, ctx);

      expect(sentUserMessages).toEqual([]);
    });
  });

  describe('/hooks command', () => {
    it('should notify with "no manifest" text before any hooks.json is loaded', async () => {
      const { hooksCommand } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });

      await hooksCommand('', ctx as unknown as ExtensionCommandContext);

      expect(ctx.notifications[0]?.[0]).toContain('No .agents/hooks.json found');
    });

    it('should reload the manifest and report the loaded hook count on "reload"', async () => {
      writeHooksManifest(projectRoot, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } });
      const { hooksCommand } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });

      await hooksCommand('reload', ctx as unknown as ExtensionCommandContext);

      expect(ctx.notifications[0]?.[0]).toContain('1 hook(s) loaded.');
    });
  });
});
