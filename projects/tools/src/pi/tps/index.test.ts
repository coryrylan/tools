import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  SessionStartEvent
} from '@earendil-works/pi-coding-agent';
import tpsExtension from './index.js';

interface Handlers {
  session_start: (event: SessionStartEvent, ctx: ExtensionContext) => void;
  message_start: (event: MessageStartEvent, ctx: ExtensionContext) => void;
  message_update: (event: MessageUpdateEvent, ctx: ExtensionContext) => void;
  message_end: (event: MessageEndEvent, ctx: ExtensionContext) => void;
  agent_end: (event: AgentEndEvent, ctx: ExtensionContext) => void;
}

interface FixtureOptions {
  reasoning?: boolean;
  thinkingLevel?: 'off' | 'high';
  hasUI?: boolean;
}

function createAssistantMessage(output = 42, stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'Result' }],
    api: 'openai-completions',
    provider: 'openai',
    model: 'test-model',
    timestamp: 0,
    stopReason,
    usage: {
      input: 100,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 100 + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  };
}

function createFixture({ reasoning = false, thinkingLevel = 'off', hasUI = true }: FixtureOptions = {}) {
  const registered: Record<string, unknown> = {};
  const setStatus = vi.fn();
  const fg = vi.fn((_color: string, text: string) => `dim(${text})`);
  const ctx = { hasUI, model: { reasoning }, ui: { setStatus, theme: { fg } } } as unknown as ExtensionContext;
  const pi = {
    on: (event: string, handler: unknown) => {
      registered[event] = handler;
    },
    getThinkingLevel: () => thinkingLevel
  } as unknown as ExtensionAPI;
  tpsExtension(pi);
  const handlers = registered as unknown as Handlers;
  const start = (message: MessageStartEvent['message'] = createAssistantMessage()) => {
    handlers.message_start({ type: 'message_start', message }, ctx);
  };
  const update = (assistantMessageEvent: AssistantMessageEvent) => {
    handlers.message_update({ type: 'message_update', message: createAssistantMessage(), assistantMessageEvent }, ctx);
  };
  const delta = (text = 'token', type: 'text_delta' | 'thinking_delta' | 'toolcall_delta' = 'text_delta') => {
    update({ type, delta: text, contentIndex: 0, partial: createAssistantMessage() });
  };
  const end = (message: MessageEndEvent['message'] = createAssistantMessage()) => {
    handlers.message_end({ type: 'message_end', message }, ctx);
  };
  return { handlers, ctx, setStatus, fg, start, update, delta, end };
}

describe('tpsExtension', () => {
  let now = 0;

  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register the five measurement lifecycle handlers', () => {
    const { handlers } = createFixture();
    expect(Object.keys(handlers).sort()).toEqual([
      'agent_end',
      'message_end',
      'message_start',
      'message_update',
      'session_start'
    ]);
  });

  describe('timing modes', () => {
    it.each([
      { reasoning: false, thinkingLevel: 'off' },
      { reasoning: false, thinkingLevel: 'high' },
      { reasoning: true, thinkingLevel: 'off' }
    ] as const)('should exclude initial latency and completion delay for %j', options => {
      const { start, delta, end, setStatus, fg } = createFixture(options);
      start();
      now = 2000;
      delta();
      now = 3000;
      delta();
      now = 9000;
      end();
      expect(fg).toHaveBeenCalledWith('dim', '~42 tok/s');
      expect(setStatus.mock.calls).toEqual([
        ['token-meter', undefined],
        ['token-meter', 'dim(~42 tok/s)']
      ]);
    });

    it('should include the full message duration when reasoning is enabled', () => {
      const { start, delta, end, setStatus } = createFixture({ reasoning: true, thinkingLevel: 'high' });
      start();
      now = 1000;
      delta();
      now = 2000;
      delta();
      now = 3000;
      end();
      expect(setStatus).toHaveBeenLastCalledWith('token-meter', 'dim(~14 tok/s)');
    });

    it('should measure reasoning messages even without content deltas', () => {
      const { start, end, setStatus } = createFixture({ reasoning: true, thinkingLevel: 'high' });
      start();
      now = 1000;
      end();
      expect(setStatus).toHaveBeenLastCalledWith('token-meter', 'dim(~42 tok/s)');
    });

    it.each(['text_delta', 'thinking_delta', 'toolcall_delta'] as const)('should time nonempty %s updates', type => {
      const { start, delta, end, setStatus } = createFixture();
      start();
      delta('first', type);
      now = 1000;
      delta('last', type);
      end();
      expect(setStatus).toHaveBeenLastCalledWith('token-meter', 'dim(~42 tok/s)');
    });

    it('should ignore empty deltas and other streaming events', () => {
      const { start, update, delta, end, setStatus } = createFixture();
      const partial = createAssistantMessage();
      start();
      delta('');
      update({ type: 'start', partial });
      now = 1000;
      delta();
      now = 2000;
      delta();
      now = 5000;
      delta('');
      update({ type: 'text_end', contentIndex: 0, content: 'done', partial });
      end();
      expect(setStatus).toHaveBeenLastCalledWith('token-meter', 'dim(~42 tok/s)');
    });
  });

  describe('rate formatting', () => {
    it.each([
      [1, 1000, '~1.0 tok/s'],
      [29, 4000, '~7.3 tok/s'],
      [99, 10000, '~9.9 tok/s'],
      [10, 1000, '~10 tok/s'],
      [424, 10000, '~42 tok/s'],
      [85, 2000, '~43 tok/s']
    ])('should format %s output tokens over %s milliseconds as %s', (output, elapsed, expected) => {
      const { start, delta, end, setStatus } = createFixture();
      start();
      delta();
      now = elapsed;
      delta();
      end(createAssistantMessage(output));
      expect(setStatus).toHaveBeenLastCalledWith('token-meter', `dim(${expected})`);
    });

    it.each(['stop', 'length', 'toolUse'] as const)('should report successful %s completions', reason => {
      const { start, delta, end, setStatus } = createFixture();
      start();
      delta();
      now = 1000;
      delta();
      end(createAssistantMessage(42, reason));
      expect(setStatus).toHaveBeenLastCalledWith('token-meter', 'dim(~42 tok/s)');
    });
  });

  describe('unusable measurements', () => {
    it.each(['error', 'aborted'] as const)('should discard %s messages', reason => {
      const { start, delta, end, setStatus } = createFixture();
      start();
      delta();
      now = 1000;
      delta();
      end(createAssistantMessage(42, reason));
      end();
      expect(setStatus.mock.calls).toEqual([['token-meter', undefined]]);
    });

    it('should not display a rate when output usage is zero', () => {
      const { start, delta, end, setStatus } = createFixture();
      start();
      delta();
      now = 1000;
      delta();
      end(createAssistantMessage(0));
      expect(setStatus.mock.calls).toEqual([['token-meter', undefined]]);
    });

    it.each(['no deltas', 'one delta', 'same timestamp'] as const)('should not display a rate for %s', scenario => {
      const { start, delta, end, setStatus } = createFixture();
      start();
      if (scenario !== 'no deltas') delta();
      if (scenario === 'same timestamp') delta();
      now = 1000;
      end();
      expect(setStatus.mock.calls).toEqual([['token-meter', undefined]]);
    });

    it('should not display a rate for a zero-duration reasoning message', () => {
      const { start, end, setStatus } = createFixture({ reasoning: true, thinkingLevel: 'high' });
      start();
      end();
      expect(setStatus.mock.calls).toEqual([['token-meter', undefined]]);
    });

    it('should ignore updates and completions without an assistant message start', () => {
      const { delta, end, setStatus } = createFixture();
      delta();
      now = 1000;
      delta();
      end();
      expect(setStatus).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('should preserve measurements across user and tool-result messages', () => {
      const { start, delta, end, setStatus } = createFixture();
      const user = { role: 'user', content: 'Continue', timestamp: 0 } as const;
      const tool = {
        role: 'toolResult',
        toolCallId: '1',
        toolName: 'bash',
        content: [],
        isError: false,
        timestamp: 0
      } satisfies MessageStartEvent['message'];
      start(user);
      end(user);
      expect(setStatus).not.toHaveBeenCalled();
      start();
      delta();
      start(tool);
      end(tool);
      now = 1000;
      delta();
      end();
      expect(setStatus).toHaveBeenLastCalledWith('token-meter', 'dim(~42 tok/s)');
    });

    it('should measure each assistant message independently and clear the prior rate', () => {
      const { start, delta, end, setStatus } = createFixture();
      start();
      delta();
      now = 1000;
      delta();
      end();
      now = 5000;
      start();
      delta();
      now = 7000;
      delta();
      end();
      end();
      expect(setStatus.mock.calls).toEqual([
        ['token-meter', undefined],
        ['token-meter', 'dim(~42 tok/s)'],
        ['token-meter', undefined],
        ['token-meter', 'dim(~21 tok/s)']
      ]);
    });

    it('should replace an unfinished measurement at the next assistant message start', () => {
      const { start, delta, end, setStatus } = createFixture();
      start();
      delta();
      now = 1000;
      start();
      now = 2000;
      delta();
      now = 3000;
      delta();
      end();
      expect(setStatus).toHaveBeenLastCalledWith('token-meter', 'dim(~42 tok/s)');
    });

    it.each(['startup', 'new', 'reload', 'resume', 'fork'] as const)(
      'should reset measurements and clear status on %s',
      reason => {
        const { start, delta, end, handlers, ctx, setStatus } = createFixture();
        start();
        delta();
        handlers.session_start({ type: 'session_start', reason }, ctx);
        now = 1000;
        delta();
        end();
        expect(setStatus.mock.calls).toEqual([
          ['token-meter', undefined],
          ['token-meter', undefined]
        ]);
      }
    );

    it('should discard unfinished measurements at agent end without clearing the displayed rate', () => {
      const { start, delta, end, handlers, ctx, setStatus } = createFixture();
      start();
      delta();
      now = 1000;
      delta();
      end();
      handlers.agent_end({ type: 'agent_end', messages: [] }, ctx);
      expect(setStatus).toHaveBeenLastCalledWith('token-meter', 'dim(~42 tok/s)');
      start();
      delta();
      handlers.agent_end({ type: 'agent_end', messages: [] }, ctx);
      now = 2000;
      delta();
      end();
      expect(setStatus).toHaveBeenCalledTimes(3);
      expect(setStatus).toHaveBeenLastCalledWith('token-meter', undefined);
    });

    it('should not access UI methods in a headless session', () => {
      const { start, delta, end, handlers, ctx, setStatus, fg } = createFixture({ hasUI: false });
      Object.defineProperty(ctx, 'ui', {
        get: () => {
          throw new Error('Headless UI must not be accessed');
        }
      });
      handlers.session_start({ type: 'session_start', reason: 'startup' }, ctx);
      start();
      delta();
      now = 1000;
      delta();
      end();
      handlers.agent_end({ type: 'agent_end', messages: [] }, ctx);
      expect(setStatus).not.toHaveBeenCalled();
      expect(fg).not.toHaveBeenCalled();
    });
  });
});
