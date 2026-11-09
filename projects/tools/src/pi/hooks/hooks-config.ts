import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readFile, realpath } from 'node:fs/promises';
import {
  approveProjectHooks,
  findHooksFile,
  isHookContextCurrent,
  isProjectTrusted,
  validateHookRuntime,
  type HookAuthorization
} from './hook-trust.js';

/** Timeout applied to a command hook when `.agents/hooks.json` omits `timeout`. */
export const DEFAULT_TIMEOUT_SECONDS = 60;

/** Claude-Code-compatible lifecycle events this extension understands. */
export const HOOK_EVENT_NAMES = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];

/** A single `type: "command"` hook entry parsed from `.agents/hooks.json`. */
export interface HookCommand {
  type: 'command';
  command: string;
  timeoutSeconds: number;
  statusMessage?: string | undefined;
}

/** A matcher plus the command hooks that run when it matches. */
export interface HookGroup {
  matcher?: string | undefined;
  hooks: HookCommand[];
}

export type HookGroupsByEvent = Partial<Record<HookEventName, HookGroup[]>>;

/** Parsed `.agents/hooks.json` state for the current project, reloaded on session start and `/hooks reload`. */
export interface HookRuntime {
  hooksFile?: string | undefined;
  projectRoot?: string | undefined;
  hooks: HookGroupsByEvent;
  loadError?: string | undefined;
  disabledReason?: string | undefined;
  authorization?: HookAuthorization | undefined;
}

/** Loads only explicitly authorized cwd-local hooks. Missing files and failures never execute commands. */
export async function loadHookRuntime(ctx: ExtensionContext, controller = new AbortController()): Promise<HookRuntime> {
  if (!isProjectTrusted(ctx)) {
    return { hooks: {}, disabledReason: 'Pi project trust is denied or unavailable.' };
  }

  let hooksFile: string | undefined;
  try {
    const authorization: HookAuthorization = {
      cwd: ctx.cwd,
      projectRoot: await realpath(ctx.cwd),
      sessionId: ctx.sessionManager.getSessionId(),
      controller
    };
    const resolution = await findHooksFile(authorization.projectRoot);
    if (resolution.disabledReason) return { hooks: {}, disabledReason: resolution.disabledReason };
    hooksFile = resolution.path;
    if (!hooksFile) return { hooks: {} };

    return await loadAuthorizedHooks({ ctx, authorization, hooksFile });
  } catch (error) {
    // Filesystem/configuration boundary: invalid JSON, inaccessible paths, and trust-store failures disable hooks.
    return { hooksFile, hooks: {}, loadError: getErrorMessage(error) };
  }
}

interface LoadAuthorizedHooksOptions {
  ctx: ExtensionContext;
  authorization: HookAuthorization;
  hooksFile: string;
}

async function loadAuthorizedHooks({
  ctx,
  authorization,
  hooksFile
}: LoadAuthorizedHooksOptions): Promise<HookRuntime> {
  const approval = isHookContextCurrent(authorization, ctx)
    ? await approveProjectHooks(authorization, ctx)
    : 'unresolved';
  if (approval !== 'approved') {
    return {
      hooks: {},
      disabledReason:
        approval === 'denied'
          ? 'Pi project trust or session-only hook consent was denied.'
          : 'No explicit hook consent. Save Pi project trust with /trust and restart, or allow hooks in the TUI.'
    };
  }

  const runtime: HookRuntime = { hooksFile, projectRoot: authorization.projectRoot, hooks: {}, authorization };
  if (!(await validateHookRuntime(runtime, ctx))) return runtime;
  const hooks = parseHooksJson(JSON.parse(await readFile(hooksFile, 'utf8')));
  if (await validateHookRuntime(runtime, ctx)) runtime.hooks = hooks;
  return runtime;
}

/** Parses the `hooks` object of a `.agents/hooks.json` payload, dropping anything malformed rather than throwing. */
export function parseHooksJson(value: unknown): HookGroupsByEvent {
  const hooksRoot = asRecord(asRecord(value)?.['hooks']);
  const hooks: HookGroupsByEvent = {};
  if (!hooksRoot) return hooks;

  HOOK_EVENT_NAMES.forEach(eventName => {
    const rawGroups = hooksRoot[eventName];
    const groups = Array.isArray(rawGroups) ? rawGroups.map(parseHookGroup).filter(isDefined) : [];
    if (groups.length > 0) hooks[eventName] = groups;
  });

  return hooks;
}

function parseHookGroup(value: unknown): HookGroup | undefined {
  const group = asRecord(value);
  const rawHooks = group?.['hooks'];
  const hooks = Array.isArray(rawHooks) ? rawHooks.map(parseHookCommand).filter(isDefined) : [];
  if (!group || hooks.length === 0) return undefined;

  const matcher = typeof group['matcher'] === 'string' ? group['matcher'] : undefined;
  return { matcher, hooks };
}

function parseHookCommand(value: unknown): HookCommand | undefined {
  const hook = asRecord(value);
  if (!hook || hook['type'] !== 'command' || typeof hook['command'] !== 'string') return undefined;

  return {
    type: 'command',
    command: hook['command'],
    timeoutSeconds: parseHookTimeoutSeconds(hook),
    statusMessage: typeof hook['statusMessage'] === 'string' ? hook['statusMessage'] : undefined
  };
}

function parseHookTimeoutSeconds(hook: Record<string, unknown>): number {
  const timeout = hook['timeout'];
  return typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_SECONDS;
}

/** Narrows to a plain (non-array, non-null) object record, the shape `.agents/hooks.json` parsing walks. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** Extracts a human-readable message from a thrown value that may not be an `Error`. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
