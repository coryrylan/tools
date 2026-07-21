import { describe, expect, it } from 'vitest';
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
  ToolDefinition
} from '@earendil-works/pi-coding-agent';
import greetingExtension from './index.js';

type SessionStartHandler = (event: SessionStartEvent, ctx: ExtensionContext) => unknown;
type SpeakGreeting = (text: string, ctx: ExtensionContext, signal: AbortSignal | undefined) => Promise<void>;

interface FakePi {
  pi: ExtensionAPI;
  sessionStartHandlers: SessionStartHandler[];
  tools: Map<string, ToolDefinition>;
}

/**
 * Minimal fake `ExtensionAPI` that captures the registered session_start
 * handler and tools, cast narrowly rather than satisfying the full
 * interface - only `on` and `registerTool` are called by the extension.
 */
function createFakePi(): FakePi {
  const sessionStartHandlers: SessionStartHandler[] = [];
  const tools = new Map<string, ToolDefinition>();
  const fakePi = {
    on: (event: string, handler: SessionStartHandler) => {
      if (event === 'session_start') sessionStartHandlers.push(handler);
    },
    registerTool: (tool: ToolDefinition) => {
      tools.set(tool.name, tool);
    }
  };
  return { pi: fakePi as unknown as ExtensionAPI, sessionStartHandlers, tools };
}

/** Minimal fake `ExtensionContext`, cast narrowly - no field is read by the fake `speak` used in these tests. */
function createFakeContext(): ExtensionContext {
  return { hasUI: false } as unknown as ExtensionContext;
}

/**
 * Fake `speak` strategy that records every greeting it is asked to speak
 * instead of touching `speech.ts`, so these wiring tests never reach the
 * real `say`-spawning code.
 */
function createFakeSpeak(): { speak: SpeakGreeting; spoken: string[] } {
  const spoken: string[] = [];
  const speak: SpeakGreeting = text => {
    spoken.push(text);
    return Promise.resolve();
  };
  return { speak, spoken };
}

describe('greetingExtension', () => {
  describe('session_start', () => {
    it('should register exactly one session_start handler', () => {
      const { pi, sessionStartHandlers } = createFakePi();

      greetingExtension(pi, createFakeSpeak().speak);

      expect(sessionStartHandlers).toHaveLength(1);
    });

    it.each(['startup', 'new'] as const)('should speak a greeting when reason is %s', async reason => {
      const { pi, sessionStartHandlers } = createFakePi();
      const { speak, spoken } = createFakeSpeak();
      greetingExtension(pi, speak);

      await sessionStartHandlers[0]?.({ type: 'session_start', reason }, createFakeContext());

      expect(spoken).toHaveLength(1);
    });

    it.each(['reload', 'resume', 'fork'] as const)('should not speak when reason is %s', async reason => {
      const { pi, sessionStartHandlers } = createFakePi();
      const { speak, spoken } = createFakeSpeak();
      greetingExtension(pi, speak);

      await sessionStartHandlers[0]?.({ type: 'session_start', reason }, createFakeContext());

      expect(spoken).toEqual([]);
    });
  });

  describe('greet tool', () => {
    it('should register a tool named greet with a description', () => {
      const { pi, tools } = createFakePi();

      greetingExtension(pi, createFakeSpeak().speak);
      const tool = tools.get('greet');

      expect(tool?.name).toBe('greet');
      expect(tool?.label).toBe('Greet');
      expect(tool?.description).toContain('Greet the user aloud');
    });

    it('should speak the greeting and return it in the tool result', async () => {
      const { pi, tools } = createFakePi();
      const { speak, spoken } = createFakeSpeak();
      greetingExtension(pi, speak);
      const tool = tools.get('greet');
      if (!tool) throw new Error('Expected the greet tool to be registered.');

      const result = await tool.execute('call-1', {}, undefined, undefined, createFakeContext());

      expect(spoken).toHaveLength(1);
      expect(result.details).toEqual({ greeting: spoken[0] });
    });
  });
});
