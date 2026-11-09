import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { findHooksFile } from './hook-trust.js';
import {
  asRecord,
  DEFAULT_TIMEOUT_SECONDS,
  getErrorMessage,
  isDefined,
  loadHookRuntime,
  parseHooksJson
} from './hooks-config.js';

const scratchRoot = tmpdir();

function createContext(cwd: string): ExtensionContext {
  return {
    cwd,
    mode: 'print',
    hasUI: false,
    isProjectTrusted: () => true,
    sessionManager: { getSessionId: () => 'config-test' }
  } as unknown as ExtensionContext;
}

describe('findHooksFile', () => {
  let projectRoot: string;

  beforeEach(() => {
    mkdirSync(scratchRoot, { recursive: true });
    projectRoot = realpathSync(mkdtempSync(join(scratchRoot, 'find-hooks-file-')));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('should find .agents/hooks.json in the given directory', async () => {
    mkdirSync(join(projectRoot, '.agents'), { recursive: true });
    writeFileSync(join(projectRoot, '.agents/hooks.json'), '{}');

    await expect(findHooksFile(projectRoot)).resolves.toEqual({ path: join(projectRoot, '.agents/hooks.json') });
  });

  it('should not discover parent hooks when only the child working directory is trusted', async () => {
    mkdirSync(join(projectRoot, '.agents'), { recursive: true });
    writeFileSync(join(projectRoot, '.agents/hooks.json'), '{}');
    const nestedCwd = join(projectRoot, 'packages/app/src');
    mkdirSync(nestedCwd, { recursive: true });

    await expect(findHooksFile(nestedCwd)).resolves.toEqual({});
  });

  it('should return no path when the working directory has no hooks.json', async () => {
    const nestedCwd = join(projectRoot, 'no-hooks-here');
    mkdirSync(nestedCwd, { recursive: true });

    await expect(findHooksFile(nestedCwd)).resolves.toEqual({});
  });
});

describe('canonical hook boundaries', () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(scratchRoot, 'hook-boundary-')));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('should reject sibling-prefix symlinks rather than using a string-prefix boundary check', async () => {
    const project = join(directory, 'project');
    const sibling = join(directory, 'project-other');
    mkdirSync(join(project, '.agents'), { recursive: true });
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'hooks.json'), '{}');
    symlinkSync(join(sibling, 'hooks.json'), join(project, '.agents/hooks.json'));

    const resolution = await findHooksFile(project);

    expect(resolution.path).toBeUndefined();
    expect(resolution.disabledReason).toContain('outside the trusted');
  });

  it('should permit configuration symlinks that stay within the trusted boundary', async () => {
    mkdirSync(join(directory, '.agents'));
    writeFileSync(join(directory, 'hooks.json'), '{}');
    symlinkSync(join(directory, 'hooks.json'), join(directory, '.agents/hooks.json'));

    await expect(findHooksFile(directory)).resolves.toEqual({ path: join(directory, 'hooks.json') });
  });
});

describe('loadHookRuntime', () => {
  let projectRoot: string;

  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    mkdirSync(scratchRoot, { recursive: true });
    projectRoot = realpathSync(mkdtempSync(join(scratchRoot, 'load-hook-runtime-')));
    mkdirSync(join(projectRoot, '.agents'), { recursive: true });
    const agentDir = join(projectRoot, 'agent');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'trust.json'), JSON.stringify({ [projectRoot]: true }));
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('should parse a valid hooks.json into the runtime', async () => {
    writeFileSync(
      join(projectRoot, '.agents/hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }]
        }
      })
    );

    const runtime = await loadHookRuntime(createContext(projectRoot));

    expect(runtime.hooksFile).toBe(join(projectRoot, '.agents/hooks.json'));
    expect(runtime.projectRoot).toBe(projectRoot);
    expect(runtime.loadError).toBeUndefined();
    expect(runtime.hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre', timeoutSeconds: DEFAULT_TIMEOUT_SECONDS }] }
    ]);
  });

  it('should set loadError and empty hooks when hooks.json is malformed JSON', async () => {
    writeFileSync(join(projectRoot, '.agents/hooks.json'), '{ not valid json');

    const runtime = await loadHookRuntime(createContext(projectRoot));

    expect(runtime.hooksFile).toBe(join(projectRoot, '.agents/hooks.json'));
    expect(runtime.loadError).toBeTruthy();
    expect(runtime.hooks).toEqual({});
  });

  it('should return an empty runtime with no hooksFile when nothing is found', async () => {
    const bareDir = mkdtempSync(join(scratchRoot, 'no-manifest-'));

    const runtime = await loadHookRuntime(createContext(bareDir));

    expect(runtime).toEqual({ hooks: {} });
    rmSync(bareDir, { recursive: true, force: true });
  });
});

describe('parseHooksJson', () => {
  it('should parse a fully valid config', () => {
    const parsed = parseHooksJson({
      hooks: {
        SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo start', timeout: 30 }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }]
      }
    });

    expect(parsed.SessionStart).toEqual([
      { matcher: 'startup', hooks: [{ type: 'command', command: 'echo start', timeoutSeconds: 30 }] }
    ]);
    expect(parsed.Stop).toEqual([
      {
        matcher: undefined,
        hooks: [{ type: 'command', command: 'echo stop', timeoutSeconds: DEFAULT_TIMEOUT_SECONDS }]
      }
    ]);
  });

  it('should ignore keys that are not recognized hook event names', () => {
    const parsed = parseHooksJson({
      hooks: {
        NotARealEvent: [{ hooks: [{ type: 'command', command: 'echo nope' }] }]
      }
    });

    expect(parsed).toEqual({});
  });

  it('should drop a group whose hooks value is not an array', () => {
    const parsed = parseHooksJson({ hooks: { Stop: [{ matcher: 'x', hooks: 'not-an-array' }] } });

    expect(parsed.Stop).toBeUndefined();
  });

  it('should drop a command entry missing a command string', () => {
    const parsed = parseHooksJson({ hooks: { Stop: [{ hooks: [{ type: 'command' }] }] } });

    expect(parsed.Stop).toBeUndefined();
  });

  it('should reject hook entries whose type is not "command"', () => {
    const parsed = parseHooksJson({
      hooks: { Stop: [{ hooks: [{ type: 'script', command: 'echo nope' }] }] }
    });

    expect(parsed.Stop).toBeUndefined();
  });

  it('should default the timeout when omitted or invalid', () => {
    const parsed = parseHooksJson({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'a' },
              { type: 'command', command: 'b', timeout: -5 },
              { type: 'command', command: 'c', timeout: Number.POSITIVE_INFINITY },
              { type: 'command', command: 'd', timeout: 'thirty' },
              { type: 'command', command: 'e', timeout: 15 }
            ]
          }
        ]
      }
    });

    expect(parsed.Stop?.[0]?.hooks.map(hook => hook.timeoutSeconds)).toEqual([
      DEFAULT_TIMEOUT_SECONDS,
      DEFAULT_TIMEOUT_SECONDS,
      DEFAULT_TIMEOUT_SECONDS,
      DEFAULT_TIMEOUT_SECONDS,
      15
    ]);
  });

  it('should return an empty result for non-object input', () => {
    expect(parseHooksJson(null)).toEqual({});
    expect(parseHooksJson('nope')).toEqual({});
    expect(parseHooksJson(undefined)).toEqual({});
  });
});

describe('asRecord', () => {
  it('should return the value when it is a plain object', () => {
    expect(asRecord({ key: 1 })).toEqual({ key: 1 });
  });

  it('should return undefined for arrays, null, and primitives', () => {
    expect(asRecord([1, 2])).toBeUndefined();
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord('x')).toBeUndefined();
  });
});

describe('isDefined', () => {
  it('should return false only for undefined', () => {
    expect(isDefined(0)).toBe(true);
    expect(isDefined(null)).toBe(true);
    expect(isDefined(undefined)).toBe(false);
  });
});

describe('getErrorMessage', () => {
  it('should return the message of an Error instance', () => {
    expect(getErrorMessage(new Error('Boom'))).toBe('Boom');
  });

  it('should stringify non-Error values', () => {
    expect(getErrorMessage('plain string')).toBe('plain string');
  });
});
