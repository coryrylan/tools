import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { GREETINGS, pickRandomGreeting, speakWithSay } from './speech.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

function createFakeContext(overrides: {
  hasUI: boolean;
  notifications?: Array<[string, string | undefined]>;
  statusCalls?: Array<[string, string | undefined]>;
}): ExtensionContext {
  const notifications = overrides.notifications ?? [];
  const statusCalls = overrides.statusCalls ?? [];
  return {
    hasUI: overrides.hasUI,
    ui: {
      notify: (message: string, type?: string) => notifications.push([message, type]),
      setStatus: (key: string, text: string | undefined) => statusCalls.push([key, text])
    }
  } as unknown as ExtensionContext;
}

describe('pickRandomGreeting', () => {
  it('should always return a member of GREETINGS', () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(GREETINGS).toContain(pickRandomGreeting());
    }
  });
});

describe('speakWithSay', () => {
  it('should notify ctx.ui with the greeting text when the extension has UI', async () => {
    const notifications: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ hasUI: true, notifications });

    // An already-aborted signal guarantees speakWithSay returns before
    // spawning `say`, so this test never produces audio.
    await speakWithSay('hello', ctx, AbortSignal.abort());

    expect(notifications).toEqual([['👋 hello', 'info']]);
  });

  it('should not notify when the extension has no UI', async () => {
    const notifications: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ hasUI: false, notifications });

    await speakWithSay('hello', ctx, AbortSignal.abort());

    expect(notifications).toEqual([]);
  });

  it('should resolve without throwing when the signal is already aborted', async () => {
    const ctx = createFakeContext({ hasUI: false });

    await expect(speakWithSay('hello', ctx, AbortSignal.abort())).resolves.toBeUndefined();
  });
});

describe('speakWithSay with playback suppressed', () => {
  it('should notify but never reach the speaking status when MOSHI_CLIENT is 1', async () => {
    vi.stubEnv('MOSHI_CLIENT', '1');
    const notifications: Array<[string, string | undefined]> = [];
    const statusCalls: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ hasUI: true, notifications, statusCalls });

    // The status is set immediately before `say` is spawned, so an empty
    // status log proves this call produced no audio on macOS either.
    await speakWithSay('hello', ctx, undefined);

    expect(notifications).toEqual([['👋 hello', 'info']]);
    expect(statusCalls).toEqual([]);
  });
});
