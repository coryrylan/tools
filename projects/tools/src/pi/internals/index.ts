import { spawn } from 'node:child_process';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

export type NotificationLevel = 'info' | 'warning' | 'error';

// e.g. 'Samantha', 'Alex', 'Evan (Enhanced)' or undefined for the system default voice.
const SAY_VOICE: string | undefined = undefined;
const SAY_SPEED = 1.1;

export function isAudioPlaybackSuppressed(): boolean {
  // https://getmoshi.app/docs/terminal-sessions#moshi-client-environment-flag
  return process.env['MOSHI_CLIENT'] === '1';
}

export function isAudioPlaybackAllowed(signal?: AbortSignal): boolean {
  return process.platform === 'darwin' && !isAudioPlaybackSuppressed() && !signal?.aborted;
}

export function buildSayArgs(text: string, voice: string | undefined, speedMultiplier: number): string[] {
  const args: string[] = [];
  if (voice) args.push('-v', voice);
  if (speedMultiplier > 0) args.push('-r', String(Math.round(180 * speedMultiplier)));
  args.push(text);
  return args;
}

export async function speakText(text: string, signal?: AbortSignal): Promise<void> {
  const child = spawn('say', buildSayArgs(text, SAY_VOICE, SAY_SPEED), {
    env: process.env,
    shell: false,
    stdio: 'ignore'
  });
  return new Promise<void>(resolve => {
    const onAbort = (): void => {
      child.kill('SIGTERM');
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', () => {
      resolve(); // a missing `say` binary must not fail the caller
    });
    child.on('close', () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

export function notifyUser(ctx: ExtensionContext, message: string, level: NotificationLevel = 'info'): void {
  if (!ctx.hasUI) return;
  ctx.ui.notify(message, level);
}

export function setExtensionStatus(ctx: ExtensionContext, key: string, text: string | undefined): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(key, text);
}
