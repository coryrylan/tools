import { describe, expect, it } from 'vitest';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { buildSayArgs, GREETINGS, pickRandomGreeting, speakWithSay } from './speech.js';

/**
 * Minimal fake `ExtensionContext`, cast narrowly rather than satisfying its
 * full shape - only `hasUI` and `ui.notify`/`ui.setStatus` are read by
 * `speakWithSay`.
 */
function createFakeContext(overrides: {
  hasUI: boolean;
  notifications?: Array<[string, string | undefined]>;
}): ExtensionContext {
  const notifications = overrides.notifications ?? [];
  return {
    hasUI: overrides.hasUI,
    ui: {
      notify: (message: string, type?: string) => notifications.push([message, type]),
      setStatus: () => undefined
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
