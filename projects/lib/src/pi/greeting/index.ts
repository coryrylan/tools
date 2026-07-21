import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { pickRandomGreeting, speakWithSay } from './speech.js';

/** Speaking strategy used by both the session-start greeting and the `greet` tool. */
type SpeakGreeting = (text: string, ctx: ExtensionContext, signal: AbortSignal | undefined) => Promise<void>;

/**
 * Registers the greeting extension on `pi`: speaks a random greeting aloud
 * via macOS `say` whenever a session starts or is created, and registers a
 * `greet` tool the LLM can call to greet the user aloud on demand.
 *
 * @param pi - Extension API used to subscribe to lifecycle events and register tools.
 * @param speak - Speaking strategy; defaults to the real `say`-backed implementation. Overridable so tests can verify wiring without producing audio.
 */
export default function greetingExtension(pi: ExtensionAPI, speak: SpeakGreeting = speakWithSay): void {
  pi.on('session_start', (event, ctx) => {
    if (event.reason !== 'startup' && event.reason !== 'new') return;
    // Fire-and-forget so speaking never delays the session becoming interactive.
    void speak(pickRandomGreeting(), ctx, undefined);
  });

  pi.registerTool({
    name: 'greet',
    label: 'Greet',
    description: 'Greet the user aloud with a randomly selected spoken greeting using macOS text-to-speech.',
    promptSnippet: 'Greet the user aloud with a random spoken greeting',
    promptGuidelines: ['Use greet when the user asks to be greeted.'],
    parameters: Type.Object({}),
    // eslint-disable-next-line max-params -- signature is mandated by ToolDefinition.execute in @earendil-works/pi-coding-agent, not under this module's control
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const greeting = `${pickRandomGreeting()}...`;
      await speak(greeting, ctx, signal);
      return {
        content: [{ type: 'text' as const, text: `Greeted the user aloud: "${greeting}"` }],
        details: { greeting }
      };
    }
  });
}
