import { spawn } from 'node:child_process';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

// e.g. 'Samantha', 'Alex', 'Evan (Enhanced)' or undefined for the system default voice.
const SAY_VOICE: string | undefined = undefined;
const SAY_SPEED = 1.1;

/** Candidate greetings spoken at session start and by the `greet` tool. */
export const GREETINGS = [
  'Ready when you are.',
  'What are we building today?',
  'All systems ready.',
  'Let us get to work.',
  'Standing by for your next move.'
] as const;

/** Picks a uniformly random greeting from {@link GREETINGS}. */
export function pickRandomGreeting(): string {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)] ?? GREETINGS[0];
}

/**
 * Builds the argv for macOS `say`: an optional `-v` voice flag, an optional
 * `-r` rate flag derived from `speedMultiplier` (rate is words-per-minute;
 * 180 is `say`'s default), followed by the text to speak.
 */
export function buildSayArgs(text: string, voice: string | undefined, speedMultiplier: number): string[] {
  const args: string[] = [];
  if (voice) args.push('-v', voice);
  if (speedMultiplier > 0) args.push('-r', String(Math.round(180 * speedMultiplier)));
  args.push(text);
  return args;
}

/**
 * Spawns `say` with `args` and resolves once it exits, is aborted, or fails
 * to spawn. This is the only function in the module that produces audio -
 * tests must never call it directly.
 */
async function spawnSayProcess(args: string[], signal: AbortSignal | undefined): Promise<void> {
  const child = spawn('say', args, { env: process.env, shell: false, stdio: 'ignore' });
  return new Promise<void>(resolve => {
    const onAbort = (): void => {
      child.kill('SIGTERM');
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', () => {
      resolve(); // missing `say` binary must not fail the tool call
    });
    child.on('close', () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

/**
 * Notifies `ctx` with `text` and, on macOS, speaks it aloud via `say`. Off
 * macOS, or once `signal` is already aborted, the greeting still reaches the
 * user as a UI notification but no process is spawned.
 */
export async function speakWithSay(
  text: string,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined
): Promise<void> {
  notify(ctx, `👋 ${text}`);
  if (process.platform !== 'darwin' || signal?.aborted) return; // `say` is macOS-only; the greeting still reaches the user as text

  status(ctx, '🔊 greeting');
  try {
    await spawnSayProcess(buildSayArgs(text, SAY_VOICE, SAY_SPEED), signal);
  } finally {
    status(ctx, undefined);
  }
}

function notify(ctx: ExtensionContext, text: string): void {
  if (!ctx.hasUI) return;
  ctx.ui.notify(text, 'info');
}

function status(ctx: ExtensionContext, text: string | undefined): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus('greeting', text);
}
