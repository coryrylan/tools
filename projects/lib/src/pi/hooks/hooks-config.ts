import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Path to the project hooks manifest, resolved relative to a project root found by walking up from `cwd`. */
export const HOOKS_FILE = '.agents/hooks.json';

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
}

/**
 * Loads and parses `.agents/hooks.json` for the project containing `cwd`.
 * Never throws - a missing file yields an empty runtime, and a malformed
 * file yields an empty runtime with `loadError` set so the extension can
 * warn instead of crashing the session.
 */
export async function loadHookRuntime(cwd: string): Promise<HookRuntime> {
  const hooksFile = await findHooksFile(cwd);

  if (!hooksFile) {
    return { hooks: {} };
  }

  const projectRoot = dirname(dirname(hooksFile));

  try {
    return {
      hooksFile,
      projectRoot,
      hooks: parseHooksJson(JSON.parse(await readFile(hooksFile, 'utf8')))
    };
  } catch (error) {
    return {
      hooksFile,
      projectRoot,
      hooks: {},
      loadError: getErrorMessage(error)
    };
  }
}

/** Walks up from `cwd` looking for `.agents/hooks.json`, stopping at the filesystem root. */
export async function findHooksFile(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd);

  for (;;) {
    const hooksFile = join(current, HOOKS_FILE);
    if (await isFile(hooksFile)) {
      return hooksFile;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
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
