import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent
} from '@earendil-works/pi-coding-agent';
import { hasTrustRequiringProjectResources } from '@earendil-works/pi-coding-agent';
import agentsHooksExtension from './index.js';

const scratchRoot = tmpdir();

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
  sessionShutdown: () => void;
  toolCall: ToolCallHandler;
  toolResult: ToolResultHandler;
  agentEnd: AgentEndHandler;
  hooksCommand: HooksCommandHandler;
  sentUserMessages: Array<{ content: string; deliverAs?: string | undefined }>;
}

/**
 * Minimal fake `ExtensionAPI` capturing registered handlers, cast
 * narrowly - only `on`, `registerCommand`, `sendUserMessage` are used.
 * `sendUserMessageThrows` makes it throw, exercising the follow-up
 * queue's catch branch.
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
    sessionShutdown: handlers['session_shutdown'] as () => void,
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
  trusted?: boolean;
  mode?: ExtensionContext['mode'];
  sessionId?: string;
  consent?: boolean;
}

interface FakeContext extends ExtensionCommandContext {
  notifications: Array<[string, string]>;
  confirmations: () => Promise<boolean>;
}

/** Minimal fake `ExtensionContext`/`ExtensionCommandContext`, cast narrowly - only the fields the extension reads are provided. */
function createFakeContext(options: FakeContextOptions): FakeContext {
  const notifications: Array<[string, string]> = [];
  const confirmations = vi.fn(() => Promise.resolve(options.consent ?? false));
  return {
    cwd: options.cwd,
    hasUI: options.hasUI ?? true,
    mode: options.mode ?? 'tui',
    isProjectTrusted: () => options.trusted ?? true,
    signal: undefined,
    sessionManager: {
      getSessionId: () => options.sessionId ?? 'session-1',
      getSessionFile: () => undefined
    },
    ui: {
      confirm: confirmations,
      notify: (message: string, type = 'info') => notifications.push([message, type]),
      setStatus: () => undefined
    },
    notifications,
    confirmations
  } as unknown as FakeContext;
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
  let agentDir: string;

  beforeEach(() => {
    projectRoot = realpathSync(mkdtempSync(join(scratchRoot, 'hooks-extension-')));
    agentDir = join(projectRoot, 'agent');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'trust.json'), JSON.stringify({ [projectRoot]: true }));
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
    vi.stubEnv('HOME', projectRoot);
    vi.stubEnv('PATH', '/usr/bin:/bin');
    vi.stubEnv('TMPDIR', projectRoot);
    vi.stubEnv('PI_HOOKS_ENV_ALLOW', '');
    vi.spyOn(childProcess, 'spawn');
    vi.spyOn(fsPromises, 'readFile');
    syncBuiltinESMExports();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    vi.unstubAllEnvs();
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

  describe('project hook authorization', () => {
    function writeLifecycleHooks(root = projectRoot): void {
      const group = [{ hooks: [{ type: 'command', command: 'printf hook-output' }] }];
      writeHooksManifest(root, { hooks: { SessionStart: group, PreToolUse: group, PostToolUse: group, Stop: group } });
    }

    async function runToolLifecycle(fake: FakePi, ctx: ExtensionContext): Promise<void> {
      await fake.toolCall(buildToolCallEvent(), ctx);
      await fake.toolResult(buildToolResultEvent(), ctx);
      await fake.agentEnd({ type: 'agent_end', messages: [] }, ctx);
    }

    it('should never read hook contents, prompt, or spawn at untrusted startup and reload', async () => {
      writeLifecycleHooks();
      const spawn = vi.spyOn(childProcess, 'spawn');
      const readFile = vi.spyOn(fsPromises, 'readFile');
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot, trusted: false, consent: true });

      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await fake.hooksCommand('reload', ctx);
      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
      expect(ctx.confirmations).not.toHaveBeenCalled();
      expect(ctx.notifications.some(([message]) => message.includes('trust is denied'))).toBe(true);
    });

    it('should fail closed when the host does not expose the trust API', async () => {
      writeLifecycleHooks();
      const spawn = vi.spyOn(childProcess, 'spawn');
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      Object.assign(ctx, { isProjectTrusted: undefined });

      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await fake.hooksCommand('reload', ctx);
      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 'undecided', Promise.resolve(true)])(
      'should reject unresolved trust value %s',
      async decision => {
        writeLifecycleHooks();
        const spawn = vi.spyOn(childProcess, 'spawn');
        const fake = createFakePi();
        const ctx = createFakeContext({ cwd: projectRoot });
        Object.assign(ctx, { isProjectTrusted: () => decision });

        await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
        await fake.hooksCommand('reload', ctx);
        await runToolLifecycle(fake, ctx);

        expect(spawn).not.toHaveBeenCalled();
      }
    );

    it.each(['print', 'json', 'rpc'] as const)('should not approve hooks-only projects in %s mode', async mode => {
      writeLifecycleHooks();
      writeFileSync(join(agentDir, 'trust.json'), '{}');
      const spawn = vi.spyOn(childProcess, 'spawn');
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot, mode, hasUI: mode === 'rpc', consent: true });

      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await fake.hooksCommand('reload', ctx);
      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
      expect(ctx.confirmations).not.toHaveBeenCalled();
      if (mode !== 'rpc') expect(error).toHaveBeenCalledWith(expect.stringContaining('No explicit hook consent'));
    });

    it('should require explicit consent even when Pi implicitly considers a hooks-only project trusted', async () => {
      writeLifecycleHooks();
      expect(hasTrustRequiringProjectResources(projectRoot)).toBe(false);
      writeFileSync(join(agentDir, 'trust.json'), '{}');
      const spawn = vi.spyOn(childProcess, 'spawn');
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });

      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await fake.hooksCommand('reload', ctx);
      await runToolLifecycle(fake, ctx);

      expect(ctx.confirmations).toHaveBeenCalledTimes(2);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should honor session-only hook consent without writing a trust decision', async () => {
      writeLifecycleHooks();
      writeFileSync(join(agentDir, 'trust.json'), '{}');
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot, consent: true });
      const spawn = vi.spyOn(childProcess, 'spawn');

      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await runToolLifecycle(fake, ctx);

      expect(spawn).toHaveBeenCalledTimes(4);
      expect(await fsPromises.readFile(join(agentDir, 'trust.json'), 'utf8')).toBe('{}');
    });

    it.each(['startup', 'reload', 'new', 'resume', 'fork'])(
      'should preserve trusted %s and tool lifecycle hooks',
      async reason => {
        writeLifecycleHooks();
        const fake = createFakePi();
        const ctx = createFakeContext({ cwd: projectRoot, mode: 'print', hasUI: false });
        const spawn = vi.spyOn(childProcess, 'spawn');

        await fake.sessionStart({ type: 'session_start', reason }, ctx);
        await runToolLifecycle(fake, ctx);

        expect(spawn).toHaveBeenCalledTimes(4);
        expect(ctx.confirmations).not.toHaveBeenCalled();
        expect(fake.sentUserMessages).toEqual([]);
      }
    );

    it('should discard authorization on trust revocation and not revive it when trust returns', async () => {
      writeLifecycleHooks();
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      const spawn = vi.spyOn(childProcess, 'spawn').mockClear();
      ctx.isProjectTrusted = () => false;
      await runToolLifecycle(fake, ctx);
      ctx.isProjectTrusted = () => true;
      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
    });

    it.each(['directory', 'session', 'shutdown'] as const)(
      'should not retain hooks after a %s transition',
      async transition => {
        writeLifecycleHooks();
        const fake = createFakePi();
        const ctx = createFakeContext({ cwd: projectRoot });
        await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
        const spawn = vi.spyOn(childProcess, 'spawn').mockClear();
        mkdirSync(join(projectRoot, 'other'));
        const next = createFakeContext({
          cwd: transition === 'directory' ? join(projectRoot, 'other') : projectRoot,
          sessionId: transition === 'session' ? 'new-session' : 'session-1'
        });
        if (transition === 'shutdown') fake.sessionShutdown();

        await runToolLifecycle(fake, next);
        await runToolLifecycle(fake, ctx);

        expect(spawn).not.toHaveBeenCalled();
        expect(fake.sentUserMessages).toEqual([]);
      }
    );

    it('should clear trusted hooks before an untrusted reload and never spawn old commands', async () => {
      writeLifecycleHooks();
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      const spawn = vi.spyOn(childProcess, 'spawn').mockClear();
      ctx.isProjectTrusted = () => false;

      await fake.hooksCommand('reload', ctx);
      ctx.isProjectTrusted = () => true;
      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
    });

    it('should reject a saved denial even if Pi context trust is true', async () => {
      writeLifecycleHooks();
      writeFileSync(join(agentDir, 'trust.json'), JSON.stringify({ [projectRoot]: false }));
      const spawn = vi.spyOn(childProcess, 'spawn');
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot, consent: true });

      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await fake.hooksCommand('reload', ctx);
      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
      expect(ctx.confirmations).not.toHaveBeenCalled();
    });

    it('should fail closed and report invalid saved trust without reading hook contents', async () => {
      writeLifecycleHooks();
      writeFileSync(join(agentDir, 'trust.json'), '{ invalid');
      const spawn = vi.spyOn(childProcess, 'spawn');
      const readFile = vi.spyOn(fsPromises, 'readFile');
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot, mode: 'print', hasUI: false });

      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await fake.hooksCommand('reload', ctx);

      expect(spawn).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('trust store'));
    });

    it('should revoke hooks on a context change even when the event has no matching hooks', async () => {
      writeHooksManifest(projectRoot, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } });
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      const spawn = vi.spyOn(childProcess, 'spawn').mockClear();
      mkdirSync(join(projectRoot, 'child'));

      await fake.toolCall(buildToolCallEvent(), createFakeContext({ cwd: join(projectRoot, 'child') }));
      await fake.agentEnd({ type: 'agent_end', messages: [] }, ctx);

      expect(spawn).not.toHaveBeenCalled();
    });

    it('should clear old hooks when a new session starts in an untrusted directory', async () => {
      writeLifecycleHooks();
      const fake = createFakePi();
      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, createFakeContext({ cwd: projectRoot }));
      const spawn = vi.spyOn(childProcess, 'spawn').mockClear();
      const next = createFakeContext({ cwd: join(projectRoot, 'other'), trusted: false });

      await fake.sessionStart({ type: 'session_start', reason: 'resume' }, next);
      await runToolLifecycle(fake, next);
      await fake.hooksCommand('reload', next);

      expect(spawn).not.toHaveBeenCalled();
    });

    it('should not execute parent hooks when a trusted child has no configuration', async () => {
      writeLifecycleHooks();
      const child = join(projectRoot, 'child');
      mkdirSync(child);
      const spawn = vi.spyOn(childProcess, 'spawn');
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: child });

      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await fake.hooksCommand('reload', ctx);
      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
    });

    it.each(['directory', 'file'] as const)('should reject a symlinked configuration %s escaping cwd', async kind => {
      const work = join(projectRoot, 'work');
      const outside = join(projectRoot, 'outside');
      mkdirSync(work);
      writeLifecycleHooks(outside);
      if (kind === 'directory') symlinkSync(join(outside, '.agents'), join(work, '.agents'));
      else {
        mkdirSync(join(work, '.agents'));
        symlinkSync(join(outside, '.agents/hooks.json'), join(work, '.agents/hooks.json'));
      }
      const spawn = vi.spyOn(childProcess, 'spawn');
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: work });

      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await fake.hooksCommand('reload', ctx);
      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
      expect(ctx.notifications.some(([message]) => message.includes('outside the trusted'))).toBe(true);
    });

    it('should invalidate a working-directory symlink when its target changes', async () => {
      writeLifecycleHooks();
      const alias = join(projectRoot, 'alias');
      const other = join(projectRoot, 'other');
      mkdirSync(other);
      symlinkSync(projectRoot, alias);
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: alias });
      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      const spawn = vi.spyOn(childProcess, 'spawn').mockClear();
      rmSync(alias);
      symlinkSync(other, alias);

      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
    });

    it('should reject a manifest symlink retargeted outside the boundary after loading', async () => {
      const work = join(projectRoot, 'work');
      const outside = join(projectRoot, 'outside');
      writeLifecycleHooks(work);
      writeLifecycleHooks(outside);
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: work });
      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      const spawn = vi.spyOn(childProcess, 'spawn').mockClear();
      rmSync(join(work, '.agents/hooks.json'));
      symlinkSync(join(outside, '.agents/hooks.json'), join(work, '.agents/hooks.json'));

      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
    });

    it('should terminate an active hook and suppress remaining hooks on shutdown', async () => {
      writeHooksManifest(projectRoot, {
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: 'command', command: 'sleep 10' },
                { type: 'command', command: 'printf should-not-run' }
              ]
            }
          ]
        }
      });
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      const spawn = vi.spyOn(childProcess, 'spawn');
      const starting = fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await vi.waitFor(() => {
        expect(spawn).toHaveBeenCalledTimes(1);
      });

      fake.sessionShutdown();
      await starting;
      await runToolLifecycle(fake, ctx);

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(fake.sentUserMessages).toEqual([]);
    });

    it('should replace trusted hooks on reload without executing SessionStart again', async () => {
      writeLifecycleHooks();
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      const spawn = vi.spyOn(childProcess, 'spawn');
      await fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      writeHooksManifest(projectRoot, {
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'printf reloaded-hook' }] }] }
      });

      await fake.hooksCommand('reload', ctx);
      expect(spawn).toHaveBeenCalledTimes(1);
      await runToolLifecycle(fake, ctx);

      expect(spawn).toHaveBeenCalledTimes(2);
      expect(spawn.mock.calls[1]?.[1]).toEqual(['--noprofile', '--norc', '-c', 'printf reloaded-hook']);
    });

    it('should discard an outstanding consent when the runtime shuts down', async () => {
      writeLifecycleHooks();
      writeFileSync(join(agentDir, 'trust.json'), '{}');
      const fake = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });
      let allowConsent: (approved: boolean) => void = () => undefined;
      let onPrompt: () => void = () => undefined;
      const consent = new Promise<boolean>(resolve => {
        allowConsent = resolve;
      });
      const prompted = new Promise<void>(resolve => {
        onPrompt = resolve;
      });
      ctx.ui.confirm = () => {
        onPrompt();
        return consent;
      };
      const spawn = vi.spyOn(childProcess, 'spawn');
      const loading = fake.sessionStart({ type: 'session_start', reason: 'startup' }, ctx);
      await prompted;
      fake.sessionShutdown();
      allowConsent(true);
      await loading;
      await runToolLifecycle(fake, ctx);

      expect(spawn).not.toHaveBeenCalled();
    });
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

      await hooksCommand('', ctx);

      expect(ctx.notifications[0]?.[0]).toContain('No .agents/hooks.json found');
    });

    it('should reload the manifest and report the loaded hook count on "reload"', async () => {
      writeHooksManifest(projectRoot, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } });
      const { hooksCommand } = createFakePi();
      const ctx = createFakeContext({ cwd: projectRoot });

      await hooksCommand('reload', ctx);

      expect(ctx.notifications[0]?.[0]).toContain('1 hook(s) loaded.');
    });
  });
});
