import { describe, expect, it } from 'vitest';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { HookCommand, HookGroup, HookRuntime } from './hooks-config.js';
import {
  createBasePayload,
  formatHookFeedback,
  formatHookOutput,
  getHookToolName,
  isBlockingPreToolResult,
  isFailedHookResult,
  matchesHookGroup,
  runMatchingHooks,
  type HookCommandResult
} from './hook-runner.js';

/** Minimal fake `ExtensionContext`, cast narrowly - only the fields hook-runner.ts reads are provided. */
function createFakeContext(
  overrides: Partial<{ cwd: string; hasUI: boolean; sessionId: string }> = {}
): ExtensionContext {
  return {
    cwd: overrides.cwd ?? process.cwd(),
    hasUI: overrides.hasUI ?? false,
    signal: undefined,
    sessionManager: {
      getSessionId: () => overrides.sessionId ?? 'session-1',
      getSessionFile: () => undefined
    },
    ui: {
      notify: () => undefined,
      setStatus: () => undefined
    }
  } as unknown as ExtensionContext;
}

function createHookCommand(overrides: Partial<HookCommand> = {}): HookCommand {
  return { type: 'command', command: 'true', timeoutSeconds: 5, ...overrides };
}

describe('matchesHookGroup', () => {
  it('should match everything when the group has no matcher', () => {
    const group: HookGroup = { hooks: [] };

    expect(matchesHookGroup(group, 'Bash')).toBe(true);
    expect(matchesHookGroup(group, 'anything')).toBe(true);
  });

  it('should match using the matcher as a regular expression', () => {
    const group: HookGroup = { matcher: '^(Bash|Read)$', hooks: [] };

    expect(matchesHookGroup(group, 'Bash')).toBe(true);
    expect(matchesHookGroup(group, 'Read')).toBe(true);
    expect(matchesHookGroup(group, 'Write')).toBe(false);
  });

  it('should fall back to an exact string comparison when the matcher is not valid regex', () => {
    const group: HookGroup = { matcher: '[unterminated', hooks: [] };

    expect(matchesHookGroup(group, '[unterminated')).toBe(true);
    expect(matchesHookGroup(group, 'Bash')).toBe(false);
  });
});

describe('createBasePayload', () => {
  it('should build the required Claude-Code fields', () => {
    const ctx = createFakeContext({ cwd: '/repo', sessionId: 'abc123' });
    const runtime: HookRuntime = { hooks: {} };

    const payload = createBasePayload({ eventName: 'SessionStart', ctx, runtime });

    expect(payload.hook_event_name).toBe('SessionStart');
    expect(payload.cwd).toBe('/repo');
    expect(payload.session_id).toBe('abc123');
    expect(payload.transcript_path).toBeUndefined();
    expect(payload.workspace_root).toBeUndefined();
  });

  it('should include workspace-root snake/camel aliases when the runtime has a projectRoot', () => {
    const ctx = createFakeContext();
    const runtime: HookRuntime = { hooks: {}, projectRoot: '/repo' };

    const payload = createBasePayload({ eventName: 'Stop', ctx, runtime });

    expect(payload.workspace_root).toBe('/repo');
    expect(payload.workspaceRoot).toBe('/repo');
    expect(payload.project_dir).toBe('/repo');
    expect(payload.projectDir).toBe('/repo');
  });

  it('should merge extra fields into the payload', () => {
    const ctx = createFakeContext();
    const runtime: HookRuntime = { hooks: {} };

    const payload = createBasePayload({ eventName: 'PreToolUse', ctx, runtime, extra: { tool_name: 'Bash' } });

    expect(payload['tool_name']).toBe('Bash');
  });
});

describe('getHookToolName', () => {
  it('should upper-case the first letter of the tool name', () => {
    expect(getHookToolName('bash')).toBe('Bash');
    expect(getHookToolName('read')).toBe('Read');
  });
});

describe('isBlockingPreToolResult', () => {
  it('should return true when the exit code is 2', () => {
    expect(isBlockingPreToolResult(buildResult({ code: 2 }))).toBe(true);
  });

  it('should return true when the hook timed out or was aborted', () => {
    expect(isBlockingPreToolResult(buildResult({ code: 0, timedOut: true }))).toBe(true);
    expect(isBlockingPreToolResult(buildResult({ code: 0, aborted: true }))).toBe(true);
  });

  it('should return false for a plain successful or failing exit code', () => {
    expect(isBlockingPreToolResult(buildResult({ code: 0 }))).toBe(false);
    expect(isBlockingPreToolResult(buildResult({ code: 1 }))).toBe(false);
  });
});

describe('isFailedHookResult', () => {
  it('should return true for any non-zero exit code', () => {
    expect(isFailedHookResult(buildResult({ code: 1 }))).toBe(true);
    expect(isFailedHookResult(buildResult({ code: 2 }))).toBe(true);
  });

  it('should return false for a zero exit code that did not time out or abort', () => {
    expect(isFailedHookResult(buildResult({ code: 0 }))).toBe(false);
  });
});

function buildResult(overrides: Partial<HookCommandResult> = {}): HookCommandResult {
  return {
    eventName: 'PreToolUse',
    hook: createHookCommand(),
    code: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    aborted: false,
    ...overrides
  };
}

describe('formatHookOutput', () => {
  it('should return an empty string when stdout and stderr are both empty', () => {
    expect(formatHookOutput(buildResult())).toBe('');
  });

  it('should join stdout and stderr without a truncation notice when under the limits', () => {
    const output = formatHookOutput(buildResult({ stdout: 'hello\n', stderr: 'warn\n' }));

    expect(output).toBe('hello\nwarn');
  });

  it('should append a truncation notice when the output exceeds the max line count', () => {
    const totalLines = 2500;
    const stdout = Array.from({ length: totalLines }, (_unused, index) => `line${String(index)}`).join('\n');

    const output = formatHookOutput(buildResult({ stdout }));

    expect(output).toContain(`[Hook output truncated: 2000 of ${String(totalLines)} lines`);
  });
});

describe('formatHookFeedback', () => {
  it('should include the command, exit status, and output for every result', () => {
    const results = [
      buildResult({ hook: createHookCommand({ command: 'echo one' }), code: 1, stdout: 'one output' }),
      buildResult({ hook: createHookCommand({ command: 'echo two' }), timedOut: true })
    ];

    const feedback = formatHookFeedback('PostToolUse', results);

    expect(feedback).toContain('PostToolUse hook feedback:');
    expect(feedback).toContain('$ echo one');
    expect(feedback).toContain('exited 1');
    expect(feedback).toContain('one output');
    expect(feedback).toContain('$ echo two');
    expect(feedback).toContain('timed out after 5s');
  });
});

describe('runMatchingHooks', () => {
  it('should run a matching command hook and capture its stdout and exit code', async () => {
    const ctx = createFakeContext();
    const runtime: HookRuntime = {
      hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [createHookCommand({ command: 'echo hi' })] }] }
    };

    const [result] = await runMatchingHooks({
      eventName: 'PostToolUse',
      matcherTarget: 'Bash',
      payload: createBasePayload({ eventName: 'PostToolUse', ctx, runtime }),
      runtime,
      ctx
    });

    expect(result?.code).toBe(0);
    expect(result?.stdout.trim()).toBe('hi');
  });

  it('should not run hooks from groups whose matcher does not match', async () => {
    const ctx = createFakeContext();
    const runtime: HookRuntime = {
      hooks: { PostToolUse: [{ matcher: 'Read', hooks: [createHookCommand({ command: 'echo hi' })] }] }
    };

    const results = await runMatchingHooks({
      eventName: 'PostToolUse',
      matcherTarget: 'Bash',
      payload: createBasePayload({ eventName: 'PostToolUse', ctx, runtime }),
      runtime,
      ctx
    });

    expect(results).toEqual([]);
  });

  it('should write the JSON payload to the hook command stdin', async () => {
    const ctx = createFakeContext({ sessionId: 'stdin-session' });
    const runtime: HookRuntime = {
      hooks: { PreToolUse: [{ hooks: [createHookCommand({ command: 'cat' })] }] }
    };
    const payload = createBasePayload({ eventName: 'PreToolUse', ctx, runtime });

    const [result] = await runMatchingHooks({ eventName: 'PreToolUse', matcherTarget: 'Bash', payload, runtime, ctx });

    expect(JSON.parse(result?.stdout ?? '')).toEqual(payload);
  });

  it('should report exit code 2 and stop after the first blocking PreToolUse hook', async () => {
    const ctx = createFakeContext();
    const runtime: HookRuntime = {
      hooks: {
        PreToolUse: [
          { hooks: [createHookCommand({ command: 'exit 2' })] },
          { hooks: [createHookCommand({ command: 'echo should-not-run' })] }
        ]
      }
    };

    const results = await runMatchingHooks({
      eventName: 'PreToolUse',
      matcherTarget: 'Bash',
      payload: createBasePayload({ eventName: 'PreToolUse', ctx, runtime }),
      runtime,
      ctx,
      stopAfterBlockingPreHook: true
    });

    expect(results).toHaveLength(1);
    expect(results[0] && isBlockingPreToolResult(results[0])).toBe(true);
    expect(results[0]?.code).toBe(2);
  });

  it('should mark a hook as timed out and kill it when it exceeds timeoutSeconds', async () => {
    const ctx = createFakeContext();
    const runtime: HookRuntime = {
      hooks: { Stop: [{ hooks: [createHookCommand({ command: 'sleep 5', timeoutSeconds: 0.2 })] }] }
    };

    const [result] = await runMatchingHooks({
      eventName: 'Stop',
      matcherTarget: 'Stop',
      payload: createBasePayload({ eventName: 'Stop', ctx, runtime }),
      runtime,
      ctx
    });

    expect(result?.timedOut).toBe(true);
    expect(isFailedHookResult(result ?? buildResult({ code: 0 }))).toBe(true);
  }, 10_000);

  it('should capture stderr output separately from stdout', async () => {
    const ctx = createFakeContext();
    const runtime: HookRuntime = {
      hooks: { PostToolUse: [{ hooks: [createHookCommand({ command: 'echo err 1>&2' })] }] }
    };

    const [result] = await runMatchingHooks({
      eventName: 'PostToolUse',
      matcherTarget: 'Bash',
      payload: createBasePayload({ eventName: 'PostToolUse', ctx, runtime }),
      runtime,
      ctx
    });

    expect(result?.stdout.trim()).toBe('');
    expect(result?.stderr.trim()).toBe('err');
  });
});
