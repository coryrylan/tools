import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  asRecord,
  DEFAULT_TIMEOUT_SECONDS,
  findHooksFile,
  getErrorMessage,
  isDefined,
  loadHookRuntime,
  parseHooksJson
} from './hooks-config.js';

const scratchRoot = resolve(import.meta.dirname, '../../../node_modules/.cache/coryrylan-tools-tests');

describe('findHooksFile', () => {
  let projectRoot: string;

  beforeEach(() => {
    mkdirSync(scratchRoot, { recursive: true });
    projectRoot = mkdtempSync(join(scratchRoot, 'find-hooks-file-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('should find .agents/hooks.json in the given directory', async () => {
    mkdirSync(join(projectRoot, '.agents'), { recursive: true });
    writeFileSync(join(projectRoot, '.agents/hooks.json'), '{}');

    await expect(findHooksFile(projectRoot)).resolves.toBe(join(projectRoot, '.agents/hooks.json'));
  });

  it('should walk up parent directories to find .agents/hooks.json', async () => {
    mkdirSync(join(projectRoot, '.agents'), { recursive: true });
    writeFileSync(join(projectRoot, '.agents/hooks.json'), '{}');
    const nestedCwd = join(projectRoot, 'packages/app/src');
    mkdirSync(nestedCwd, { recursive: true });

    await expect(findHooksFile(nestedCwd)).resolves.toBe(join(projectRoot, '.agents/hooks.json'));
  });

  it('should return undefined when no ancestor directory has .agents/hooks.json', async () => {
    const nestedCwd = join(projectRoot, 'no-hooks-here');
    mkdirSync(nestedCwd, { recursive: true });

    await expect(findHooksFile(nestedCwd)).resolves.toBeUndefined();
  });
});

describe('loadHookRuntime', () => {
  let projectRoot: string;

  beforeEach(() => {
    mkdirSync(scratchRoot, { recursive: true });
    projectRoot = mkdtempSync(join(scratchRoot, 'load-hook-runtime-'));
    mkdirSync(join(projectRoot, '.agents'), { recursive: true });
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

    const runtime = await loadHookRuntime(projectRoot);

    expect(runtime.hooksFile).toBe(join(projectRoot, '.agents/hooks.json'));
    expect(runtime.projectRoot).toBe(projectRoot);
    expect(runtime.loadError).toBeUndefined();
    expect(runtime.hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre', timeoutSeconds: DEFAULT_TIMEOUT_SECONDS }] }
    ]);
  });

  it('should set loadError and empty hooks when hooks.json is malformed JSON', async () => {
    writeFileSync(join(projectRoot, '.agents/hooks.json'), '{ not valid json');

    const runtime = await loadHookRuntime(projectRoot);

    expect(runtime.hooksFile).toBe(join(projectRoot, '.agents/hooks.json'));
    expect(runtime.loadError).toBeTruthy();
    expect(runtime.hooks).toEqual({});
  });

  it('should return an empty runtime with no hooksFile when nothing is found', async () => {
    const bareDir = mkdtempSync(join(scratchRoot, 'no-manifest-'));

    const runtime = await loadHookRuntime(bareDir);

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
