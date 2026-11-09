import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { HookCommand, HookGroup, HookRuntime } from './hooks-config.js';
import {
  createBasePayload,
  createHookProcessEnv,
  formatHookFeedback,
  formatHookOutput,
  getHookToolName,
  isBlockingPreToolResult,
  isFailedHookResult,
  matchesHookGroup,
  runMatchingHooks as runHooks,
  type RunHookOptions,
  type HookCommandResult
} from './hook-runner.js';

let fixtureRoot = '/repo';

async function runMatchingHooks(options: RunHookOptions): Promise<HookCommandResult[]> {
  options.runtime.projectRoot = fixtureRoot;
  options.runtime.hooksFile = join(fixtureRoot, '.agents/hooks.json');
  options.runtime.authorization = {
    cwd: options.ctx.cwd,
    projectRoot: fixtureRoot,
    sessionId: options.ctx.sessionManager.getSessionId(),
    controller: new AbortController()
  };
  return runHooks(options);
}

/** Minimal fake `ExtensionContext`, cast narrowly - only the fields hook-runner.ts reads are provided. */
function createFakeContext(
  overrides: Partial<{ cwd: string; hasUI: boolean; sessionId: string }> = {}
): ExtensionContext {
  return {
    cwd: overrides.cwd ?? fixtureRoot,
    isProjectTrusted: () => true,
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

describe('createHookProcessEnv', () => {
  it('should retain required variables and exclude synthetic credentials and runtime injection', () => {
    const env = createHookProcessEnv('/project', {
      PATH: '/synthetic/bin',
      HOME: '/synthetic/home',
      TMPDIR: '/synthetic/tmp',
      LANG: 'en_US.UTF-8',
      ANTHROPIC_API_KEY: 'synthetic-anthropic-secret',
      AWS_SECRET_ACCESS_KEY: 'synthetic-aws-secret',
      NPM_TOKEN: 'synthetic-npm-secret',
      SSH_AUTH_SOCK: '/synthetic/ssh-agent',
      MISE_GITHUB_TOKEN: 'synthetic-mise-secret',
      MISE_TRUSTED_CONFIG_PATHS: '/synthetic/trusted',
      MISE_YES: '1',
      __MISE_DIFF: 'synthetic-serialized-environment-secret',
      XDG_SYNTHETIC_SECRET: 'synthetic-xdg-secret',
      BASH_ENV: '/synthetic/startup.sh',
      NODE_OPTIONS: '--require=/synthetic/startup.js',
      LD_PRELOAD: '/synthetic/library.so'
    });

    expect(env).toEqual({
      PATH: '/synthetic/bin',
      HOME: '/synthetic/home',
      TMPDIR: '/synthetic/tmp',
      LANG: 'en_US.UTF-8',
      AGENTS_PROJECT_DIR: '/project',
      CODEX_PROJECT_DIR: '/project',
      CODEX_WORKSPACE_ROOT: '/project',
      WORKSPACE_ROOT: '/project',
      PROJECT_DIR: '/project'
    });
  });

  it('should preserve XDG and mise runtime directory overrides', () => {
    const directories = {
      XDG_CACHE_HOME: '/synthetic/xdg/cache',
      XDG_CONFIG_HOME: '/synthetic/xdg/config',
      XDG_CONFIG_DIRS: '/synthetic/xdg/config-search',
      XDG_DATA_HOME: '/synthetic/xdg/data',
      XDG_DATA_DIRS: '/synthetic/xdg/data-search',
      XDG_STATE_HOME: '/synthetic/xdg/state',
      XDG_RUNTIME_DIR: '/synthetic/xdg/runtime',
      MISE_CACHE_DIR: '/synthetic/mise/cache',
      MISE_CONFIG_DIR: '/synthetic/mise/config',
      MISE_DATA_DIR: '/synthetic/mise/data',
      MISE_STATE_DIR: '/synthetic/mise/state',
      MISE_TMP_DIR: '/synthetic/mise/tmp'
    };

    expect(createHookProcessEnv('/project', directories)).toMatchObject(directories);
  });

  it('should inherit only explicitly named opt-ins and never inherit shell startup or exported functions', () => {
    const env = createHookProcessEnv('/project', {
      PI_HOOKS_ENV_ALLOW: ' CI, NPM_TOKEN, BASH_ENV, ENV, SHELLOPTS, BASHOPTS, BASH_FUNC_test%%, invalid-name ',
      CI: 'true',
      NPM_TOKEN: 'synthetic-opted-in-secret',
      BASH_ENV: '/synthetic/startup.sh',
      ENV: '/synthetic/startup.sh',
      SHELLOPTS: 'xtrace',
      BASHOPTS: 'extdebug',
      'BASH_FUNC_test%%': '() { echo injected; }',
      'invalid-name': 'invalid',
      OTHER_SECRET: 'synthetic-excluded-secret'
    });

    expect(env['CI']).toBe('true');
    expect(env['NPM_TOKEN']).toBe('synthetic-opted-in-secret');
    expect(Object.keys(env).sort()).toEqual([
      'AGENTS_PROJECT_DIR',
      'CI',
      'CODEX_PROJECT_DIR',
      'CODEX_WORKSPACE_ROOT',
      'NPM_TOKEN',
      'PROJECT_DIR',
      'WORKSPACE_ROOT'
    ]);
  });
});

describe('runMatchingHooks', () => {
  beforeEach(() => {
    fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'hook-runner-')));
    mkdirSync(join(fixtureRoot, '.agents'));
    writeFileSync(join(fixtureRoot, '.agents/hooks.json'), '{}');
    vi.stubEnv('PATH', '/usr/bin:/bin');
    vi.stubEnv('HOME', fixtureRoot);
    vi.stubEnv('TMPDIR', fixtureRoot);
    vi.stubEnv('PI_HOOKS_ENV_ALLOW', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('should not execute a runtime with no authorization', async () => {
    const ctx = createFakeContext();
    const runtime: HookRuntime = { hooks: { Stop: [{ hooks: [createHookCommand({ command: 'exit 9' })] }] } };

    await expect(
      runHooks({
        eventName: 'Stop',
        matcherTarget: 'Stop',
        payload: createBasePayload({ eventName: 'Stop', ctx, runtime }),
        runtime,
        ctx
      })
    ).resolves.toEqual([]);
  });

  it('should exclude synthetic secrets and BASH_ENV from real child processes', async () => {
    const startup = join(fixtureRoot, 'startup.sh');
    writeFileSync(startup, 'printf startup-was-sourced');
    vi.stubEnv('BASH_ENV', startup);
    vi.stubEnv('SYNTHETIC_SECRET', 'never-inherit-this');
    const ctx = createFakeContext();
    const runtime: HookRuntime = {
      hooks: {
        Stop: [{ hooks: [createHookCommand({ command: 'printf "%s|%s|%s" "$SYNTHETIC_SECRET" "$BASH_ENV" "$HOME"' })] }]
      }
    };

    const [result] = await runMatchingHooks({
      eventName: 'Stop',
      matcherTarget: 'Stop',
      payload: createBasePayload({ eventName: 'Stop', ctx, runtime }),
      runtime,
      ctx
    });

    expect(result?.stdout).toBe(`||${fixtureRoot}`);
    expect(result?.code).toBe(0);
  });

  it('should pass runtime directory overrides to child processes without mise secrets or trust overrides', async () => {
    const cacheDirectory = join(fixtureRoot, 'mise-cache');
    const configDirectory = join(fixtureRoot, 'mise-config');
    const xdgCacheDirectory = join(fixtureRoot, 'xdg-cache');
    vi.stubEnv('MISE_CACHE_DIR', cacheDirectory);
    vi.stubEnv('MISE_CONFIG_DIR', configDirectory);
    vi.stubEnv('XDG_CACHE_HOME', xdgCacheDirectory);
    vi.stubEnv('MISE_GITHUB_TOKEN', 'synthetic-mise-secret');
    vi.stubEnv('MISE_TRUSTED_CONFIG_PATHS', '/synthetic/trusted');
    vi.stubEnv('__MISE_DIFF', 'synthetic-serialized-environment-secret');
    const ctx = createFakeContext();
    const runtime: HookRuntime = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              createHookCommand({
                command:
                  'printf "%s\\n" "$MISE_CACHE_DIR" "$MISE_CONFIG_DIR" "$XDG_CACHE_HOME" "${MISE_GITHUB_TOKEN-unset}" "${MISE_TRUSTED_CONFIG_PATHS-unset}" "${__MISE_DIFF-unset}"'
              })
            ]
          }
        ]
      }
    };

    const [result] = await runMatchingHooks({
      eventName: 'SessionStart',
      matcherTarget: 'startup',
      payload: createBasePayload({ eventName: 'SessionStart', ctx, runtime }),
      runtime,
      ctx
    });

    expect(result?.code).toBe(0);
    expect(result?.stdout.split('\n')).toEqual([
      cacheDirectory,
      configDirectory,
      xdgCacheDirectory,
      'unset',
      'unset',
      'unset',
      ''
    ]);
  });

  it('should inherit PATH without starting a login shell', async () => {
    const ctx = createFakeContext();
    const runtime: HookRuntime = {
      hooks: {
        SessionStart: [
          { hooks: [createHookCommand({ command: 'shopt -q login_shell && exit 7; printf "%s" "$PATH"' })] }
        ]
      }
    };

    const [result] = await runMatchingHooks({
      eventName: 'SessionStart',
      matcherTarget: 'startup',
      payload: createBasePayload({ eventName: 'SessionStart', ctx, runtime }),
      runtime,
      ctx
    });

    expect(result?.code).toBe(0);
    expect(result?.stdout).toBe(process.env['PATH']);
    expect(result?.stderr).toBe('');
  });

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
