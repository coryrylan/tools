import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir, ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { HookRuntime } from './hooks-config.js';

/** Session-local authorization for exactly one canonical working directory, not its ancestors. */
export interface HookAuthorization {
  cwd: string;
  projectRoot: string;
  sessionId: string;
  controller: AbortController;
}

export function isProjectTrusted(ctx: ExtensionContext): boolean {
  const decision: unknown = typeof ctx.isProjectTrusted === 'function' ? ctx.isProjectTrusted() : undefined;
  return decision === true;
}

export function isHookContextCurrent(authorization: HookAuthorization, ctx: ExtensionContext): boolean {
  return (
    !authorization.controller.signal.aborted &&
    isProjectTrusted(ctx) &&
    ctx.cwd === authorization.cwd &&
    ctx.sessionManager.getSessionId() === authorization.sessionId
  );
}

type HookApproval = 'approved' | 'denied' | 'unresolved';

/** Uses Pi's saved trust; implicit resource-free trust requires explicit TUI-only hook consent. */
export async function approveProjectHooks(
  authorization: HookAuthorization,
  ctx: ExtensionContext
): Promise<HookApproval> {
  const decision = new ProjectTrustStore(getAgentDir()).get(authorization.projectRoot);
  if (decision !== null) return decision ? 'approved' : 'denied';
  if (ctx.mode !== 'tui' || !ctx.hasUI) return 'unresolved';

  // Pi 1.5 auto-trusts resource-free directories: https://github.com/earendil-works/pi/issues/10947
  const approved = await ctx.ui.confirm(
    'Allow project hooks for this session?',
    `${authorization.projectRoot}\n\nHooks execute arbitrary shell commands with Pi's OS permissions, outside tool-call guards. This includes scripts referenced by .agents/hooks.json. Only allow a project you have reviewed. This does not save or change Pi project trust.`
  );
  return approved ? 'approved' : 'denied';
}

interface HookFileResolution {
  path?: string;
  disabledReason?: string;
}

/** Resolves only cwd/.agents/hooks.json, rejecting symlink targets outside the canonical boundary. */
export async function findHooksFile(projectRoot: string): Promise<HookFileResolution> {
  try {
    const hooksFile = await realpath(join(projectRoot, '.agents/hooks.json'));
    if (!isWithinBoundary(projectRoot, hooksFile)) {
      return { disabledReason: 'Hooks configuration resolves outside the trusted working directory.' };
    }
    if (!(await stat(hooksFile)).isFile()) {
      return { disabledReason: 'Hooks configuration is not a regular file.' };
    }
    return { path: hooksFile };
  } catch (error) {
    // Filesystem boundary: absence is normal; all other failures disable hooks.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    return {
      disabledReason: `Cannot resolve hooks configuration: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function isWithinBoundary(projectRoot: string, hooksFile: string): boolean {
  const path = relative(projectRoot, hooksFile);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

export function disableHooks(runtime: HookRuntime, reason: string): void {
  runtime.authorization?.controller.abort();
  runtime.hooks = {};
  runtime.disabledReason = reason;
}

/** Revalidates trust, session, cwd, and manifest location immediately before every subprocess. */
export async function validateHookRuntime(runtime: HookRuntime, ctx: ExtensionContext): Promise<boolean> {
  const authorization = runtime.authorization;
  if (!authorization || runtime.disabledReason) return false;

  let reason = 'Project trust, session, or working directory changed; use /hooks reload to reauthorize.';
  try {
    if (
      isHookContextCurrent(authorization, ctx) &&
      (await realpath(ctx.cwd)) === authorization.projectRoot &&
      (await findHooksFile(authorization.projectRoot)).path === runtime.hooksFile &&
      isHookContextCurrent(authorization, ctx)
    ) {
      return true;
    }
  } catch {
    // Filesystem boundary: a removed, inaccessible, or retargeted path revokes authorization.
    reason = 'The hooks configuration or working directory is no longer within the authorized boundary.';
  }
  disableHooks(runtime, reason);
  reportHooksDisabled(ctx, reason);
  return false;
}

export function reportHooksDisabled(ctx: ExtensionContext, reason: string): void {
  const message = `Project hooks disabled: ${reason}`;
  if (ctx.hasUI) ctx.ui.notify(message, 'warning');
  else console.error(message);
}
