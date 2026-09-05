import type { Api, AssistantMessage, Context, Model, TextContent } from '@earendil-works/pi-ai';
import type { AgentEndEvent, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { complete } from '@earendil-works/pi-ai/compat';
import { execFileSync, spawn } from 'node:child_process';
import {
  isAudioPlaybackSuppressed,
  isAudioPlaybackAllowed,
  notifyUser,
  setExtensionStatus,
  speakText
} from '../internals/index.js';
import { clipToSentence, spellAcronyms, stripMarkdown } from './speech-text.js';

const STATUS_KEY = 'audio-summary';
// '<provider>/<id>' from models.json; undefined falls back to the current model.
const SUMMARY_MODEL: string | undefined = 'spark/gemma-4-e2b';
const MAX_OUTPUT_CHARS = 300;
// Measured: gemma-4-e2b spends 600-700 tokens reasoning before it emits any prose, and llama.cpp
// accepts but ignores reasoning_effort - too tight a cap returns an empty summary, not a short one.
// MAX_OUTPUT_CHARS is enforced by clipping the result instead.
const SUMMARY_MAX_TOKENS = 2048;

export default function audioSummaryExtension(pi: ExtensionAPI): void {
  pi.on('agent_end', async (event, ctx) => {
    try {
      await handleAgentEnd(event, ctx);
    } finally {
      setStatus(ctx, undefined);
    }
  });
}

async function handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext): Promise<void> {
  const text = extractLastMessageText(event.messages);
  if (!text?.trim()) return;

  if (isSummaryDeliveryBlocked(ctx)) return;

  const summary = (await summarizeWithModel(text, ctx))?.trim();
  chimeIfSystemAudioInactive();
  const spoken = summary || text.trim();
  await speakWithSay(clipToSentence(stripMarkdown(spoken), MAX_OUTPUT_CHARS), ctx);
}

export function extractLastMessageText(messages: AgentEndEvent['messages']): string | undefined {
  const lastMessage = messages.at(-1);
  if (!lastMessage || !('content' in lastMessage)) return undefined;

  const content = lastMessage.content;
  if (typeof content === 'string') return content;

  const lastPart = content.at(-1);
  if (!lastPart || lastPart.type !== 'text') return undefined;

  return lastPart.text;
}

async function summarizeWithModel(turnText: string, ctx: ExtensionContext): Promise<string | undefined> {
  const model = selectSummaryModel(ctx);
  if (!model) return undefined;

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) return undefined;

  setStatus(ctx, `✏️ summarizing${SUMMARY_MODEL ? ` (${SUMMARY_MODEL})` : ''}`);
  try {
    const response = await complete(model, buildSummaryContext(turnText), {
      ...(auth.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
      ...(auth.headers === undefined ? {} : { headers: auth.headers }),
      reasoningEffort: 'minimal',
      maxTokens: SUMMARY_MAX_TOKENS
    });
    return extractAssistantMessageText(response);
  } catch {
    return undefined; // network/model error -> caller falls back to the raw turn text
  }
}

function buildSummaryContext(turnText: string): Context {
  return {
    messages: [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: buildSummaryPrompt(turnText) }],
        timestamp: Date.now()
      }
    ]
  };
}

function buildSummaryPrompt(turnText: string): string {
  return `Rephrase this to be suitable to be read aloud. Do not use markdown, bullet points, file diffs, or code fences. Avoid reading raw file paths, URLs, or slash commands verbatim; describe them in natural speech instead. Write acronyms in plain text with period dividers, such as CLI as C.L.I. Do not transform acronyms inside source code examples or code blocks. Mention only completed work, notable blockers, or requested next action. Use present tense and preserve the original tone and style of the input. Keep under ${String(MAX_OUTPUT_CHARS)} chars.\n<turn>${turnText}</turn>`;
}

/** Joins every text part of an assistant response into a single string, discarding thinking/tool-call parts. */
export function extractAssistantMessageText(response: AssistantMessage): string {
  return response.content
    .filter((part): part is TextContent => part.type === 'text')
    .map(part => part.text)
    .join(' ');
}

/**
 * Resolves the summarization model: {@link SUMMARY_MODEL} parsed as
 * `<provider>/<id>` and looked up in `ctx.modelRegistry`, falling back to
 * `ctx.model` when unset, malformed, or unresolved.
 */
export function selectSummaryModel(ctx: ExtensionContext): Model<Api> | undefined {
  const currentModel = ctx.model;
  if (!SUMMARY_MODEL) return currentModel;

  const slashIndex = SUMMARY_MODEL.indexOf('/');
  if (slashIndex < 0) {
    notifyUnresolvedSummaryModel(ctx);
    return currentModel; // need a '<provider>/<id>' ref; a bare id can't be resolved
  }

  const provider = SUMMARY_MODEL.slice(0, slashIndex);
  const modelId = SUMMARY_MODEL.slice(slashIndex + 1);
  const resolvedModel = ctx.modelRegistry.find(provider, modelId);
  if (!resolvedModel) {
    notifyUnresolvedSummaryModel(ctx);
    return currentModel;
  }

  return resolvedModel;
}

/** Notifies the user once that {@link SUMMARY_MODEL} didn't resolve and summarization is using the current model instead. */
export function notifyUnresolvedSummaryModel(ctx: ExtensionContext): void {
  notifyUser(ctx, `⚠️ SUMMARY_MODEL "${String(SUMMARY_MODEL)}" did not resolve; falling back to the current model`);
}

/**
 * True when the turn should be dropped: `say` is missing, or other audio is
 * already playing and would be talked over. A suppressed session skips both
 * checks - it plays nothing that could collide, and still gets the written
 * summary.
 */
function isSummaryDeliveryBlocked(ctx: ExtensionContext): boolean {
  if (isAudioPlaybackSuppressed()) return false;

  // No voice, no work: without `say` (non-macOS - e.g. inside a sandbox VM)
  if (!isSayAvailable()) {
    notifyUser(ctx, '🔊 audio summaries unavailable');
    return true;
  }

  notifyIfSystemAudioActive();
  return isSystemAudioActive();
}

function notifyIfSystemAudioActive(): void {
  if (process.platform !== 'darwin' || !isSystemAudioActive()) return;
  const child = spawn('osascript', ['-e', 'display notification "Agent needs your attention" with title "Agent"'], {
    env: process.env,
    shell: false,
    stdio: 'ignore'
  });
  child.on('error', () => undefined);
  child.unref();
}

function chimeIfSystemAudioInactive(): void {
  if (!isAudioPlaybackAllowed() || isSystemAudioActive()) return;
  const child = spawn('afplay', ['/System/Library/Sounds/Glass.aiff'], {
    env: process.env,
    shell: false,
    stdio: 'ignore'
  });
  child.on('error', () => undefined);
  child.unref();
}

function isSayAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('which', ['say'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isSystemAudioActive(): boolean {
  try {
    const out = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' });
    return /coreaudiod|com\.apple\.audio|AppleHDAEngineOutput/i.test(out);
  } catch {
    return false;
  }
}

async function speakWithSay(text: string, ctx: ExtensionContext): Promise<void> {
  if (!text.trim()) return;
  notifyUser(ctx, `🔊 ${text}`);
  if (!isAudioPlaybackAllowed()) return;

  setStatus(ctx, '🔊 speaking');
  await speakText(spellAcronyms(text));
}

function setStatus(ctx: ExtensionContext, text: string | undefined): void {
  setExtensionStatus(ctx, STATUS_KEY, text);
}
