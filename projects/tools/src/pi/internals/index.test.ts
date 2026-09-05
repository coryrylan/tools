import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSayArgs,
  isAudioPlaybackAllowed,
  isAudioPlaybackSuppressed,
  notifyUser,
  setExtensionStatus
} from './index.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

interface FakeContextOptions {
  readonly hasUI: boolean;
  readonly notifications?: Array<[string, string | undefined]>;
  readonly statusCalls?: Array<[string, string | undefined]>;
}

function createFakeContext(options: FakeContextOptions): ExtensionContext {
  const notifications = options.notifications ?? [];
  const statusCalls = options.statusCalls ?? [];
  return {
    hasUI: options.hasUI,
    ui: {
      notify: (message: string, type?: string) => notifications.push([message, type]),
      setStatus: (key: string, text: string | undefined) => statusCalls.push([key, text])
    }
  } as unknown as ExtensionContext;
}

describe('isAudioPlaybackSuppressed', () => {
  it('should return true when MOSHI_CLIENT is 1', () => {
    vi.stubEnv('MOSHI_CLIENT', '1');

    expect(isAudioPlaybackSuppressed()).toBe(true);
  });

  it('should return false when MOSHI_CLIENT is unset', () => {
    vi.stubEnv('MOSHI_CLIENT', undefined);

    expect(isAudioPlaybackSuppressed()).toBe(false);
  });

  it.each(['0', '', 'true', '2'])('should return false when MOSHI_CLIENT is %o', value => {
    vi.stubEnv('MOSHI_CLIENT', value);

    expect(isAudioPlaybackSuppressed()).toBe(false);
  });
});

describe('isAudioPlaybackAllowed', () => {
  it('should return false when MOSHI_CLIENT is 1', () => {
    vi.stubEnv('MOSHI_CLIENT', '1');

    expect(isAudioPlaybackAllowed()).toBe(false);
  });

  it('should return false when MOSHI_CLIENT is 1 even off a signal that is not aborted', () => {
    vi.stubEnv('MOSHI_CLIENT', '1');

    expect(isAudioPlaybackAllowed(new AbortController().signal)).toBe(false);
  });

  it('should return false for an already-aborted signal', () => {
    vi.stubEnv('MOSHI_CLIENT', undefined);

    expect(isAudioPlaybackAllowed(AbortSignal.abort())).toBe(false);
  });

  it('should follow the platform when nothing else blocks playback', () => {
    vi.stubEnv('MOSHI_CLIENT', undefined);

    expect(isAudioPlaybackAllowed()).toBe(process.platform === 'darwin');
  });
});

describe('buildSayArgs', () => {
  it('should return only the text argument when no voice is set and speed is zero', () => {
    expect(buildSayArgs('hello', undefined, 0)).toEqual(['hello']);
  });

  it('should prefix the text with a -v flag when a voice is provided', () => {
    expect(buildSayArgs('hello', 'Alex', 0)).toEqual(['-v', 'Alex', 'hello']);
  });

  it('should append a -r flag with the rate rounded from the speed multiplier', () => {
    expect(buildSayArgs('hello', undefined, 1.1)).toEqual(['-r', '198', 'hello']);
  });

  it('should combine the voice and rate flags ahead of the text', () => {
    expect(buildSayArgs('hello', 'Samantha', 1.5)).toEqual(['-v', 'Samantha', '-r', '270', 'hello']);
  });

  it('should omit the rate flag for a non-positive speed multiplier', () => {
    expect(buildSayArgs('hello', undefined, -1)).toEqual(['hello']);
  });
});

describe('notifyUser', () => {
  it('should notify at info level by default', () => {
    const notifications: Array<[string, string | undefined]> = [];

    notifyUser(createFakeContext({ hasUI: true, notifications }), 'hello');

    expect(notifications).toEqual([['hello', 'info']]);
  });

  it.each(['info', 'warning', 'error'] as const)('should pass through the %o level', level => {
    const notifications: Array<[string, string | undefined]> = [];

    notifyUser(createFakeContext({ hasUI: true, notifications }), 'hello', level);

    expect(notifications).toEqual([['hello', level]]);
  });

  it('should not notify when the session has no UI', () => {
    const notifications: Array<[string, string | undefined]> = [];

    notifyUser(createFakeContext({ hasUI: false, notifications }), 'hello');

    expect(notifications).toEqual([]);
  });
});

describe('setExtensionStatus', () => {
  it('should set the status under the given key', () => {
    const statusCalls: Array<[string, string | undefined]> = [];

    setExtensionStatus(createFakeContext({ hasUI: true, statusCalls }), 'greeting', '🔊 greeting');

    expect(statusCalls).toEqual([['greeting', '🔊 greeting']]);
  });

  it('should clear the status when text is undefined', () => {
    const statusCalls: Array<[string, string | undefined]> = [];

    setExtensionStatus(createFakeContext({ hasUI: true, statusCalls }), 'greeting', undefined);

    expect(statusCalls).toEqual([['greeting', undefined]]);
  });

  it('should not set a status when the session has no UI', () => {
    const statusCalls: Array<[string, string | undefined]> = [];

    setExtensionStatus(createFakeContext({ hasUI: false, statusCalls }), 'greeting', '🔊 greeting');

    expect(statusCalls).toEqual([]);
  });
});
