import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { isAudioPlaybackAllowed, notifyUser, setExtensionStatus, speakText } from '../internals/index.js';

const STATUS_KEY = 'greeting';

export const GREETINGS = [
  'Ready when you are.',
  'What are we building today?',
  'All systems ready.',
  'Let us get to work.',
  'Standing by for your next move.'
] as const;

export function pickRandomGreeting(): string {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)] ?? GREETINGS[0];
}

export async function speakWithSay(
  text: string,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined
): Promise<void> {
  notifyUser(ctx, `👋 ${text}`);
  if (!isAudioPlaybackAllowed(signal)) return;

  setExtensionStatus(ctx, STATUS_KEY, '🔊 greeting');
  try {
    await speakText(text, signal);
  } finally {
    setExtensionStatus(ctx, STATUS_KEY, undefined);
  }
}
