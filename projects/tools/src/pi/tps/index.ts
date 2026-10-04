import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { setExtensionStatus } from '../internals/index.js';

const STATUS_KEY = 'token-meter';

interface Measurement {
  mode: 'content' | 'message';
  startTime: number | null;
  endTime: number;
}

/** Displays approximate output tokens per second after each successful assistant message. */
export default function tpsExtension(pi: ExtensionAPI): void {
  let measurement: Measurement | null = null;

  pi.on('session_start', (_event, ctx) => {
    measurement = null;
    setExtensionStatus(ctx, STATUS_KEY, undefined);
  });

  pi.on('message_start', (event, ctx) => {
    if (event.message.role !== 'assistant') return;

    const mode = ctx.model?.reasoning === false || pi.getThinkingLevel() === 'off' ? 'content' : 'message';
    measurement = { mode, startTime: mode === 'message' ? performance.now() : null, endTime: 0 };
    setExtensionStatus(ctx, STATUS_KEY, undefined);
  });

  pi.on('message_update', event => {
    if (measurement?.mode !== 'content') return;

    const update = event.assistantMessageEvent;
    if (update.type !== 'text_delta' && update.type !== 'thinking_delta' && update.type !== 'toolcall_delta') return;
    if (update.delta.length === 0) return;

    const now = performance.now();
    measurement.startTime ??= now;
    measurement.endTime = now;
  });

  pi.on('message_end', (event, ctx) => {
    if (event.message.role !== 'assistant' || measurement === null) return;

    const status = getMeasurementStatus(measurement, event.message);
    measurement = null;
    if (status !== undefined && ctx.hasUI) {
      setExtensionStatus(ctx, STATUS_KEY, ctx.ui.theme.fg('dim', status));
    }
  });

  pi.on('agent_end', () => {
    measurement = null;
  });
}

function getMeasurementStatus(
  { mode, startTime, endTime }: Measurement,
  message: AssistantMessage
): string | undefined {
  if (message.stopReason === 'error' || message.stopReason === 'aborted' || startTime === null) return undefined;

  const elapsedSec = ((mode === 'content' ? endTime : performance.now()) - startTime) / 1000;
  const outputTokens = message.usage.output;
  if (outputTokens <= 0 || elapsedSec <= 0) return undefined;

  const tps = outputTokens / elapsedSec;
  const display = tps < 10 ? tps.toFixed(1) : Math.round(tps).toString();
  return `~${display} tok/s`;
}
