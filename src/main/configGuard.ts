// src/main/configGuard.ts
//
// Backup / marker / restore for the Claude Code + Codex config files
// we temporarily rewrite to point at the live-capture proxy. The whole
// reason this module exists: the renderer can crash, the OS can kill
// us, the user can yank the power cord — anything that prevents
// `before-quit` from running leaves the user's settings pointing at
// a dead localhost proxy, which silently breaks their CLI.
//
// Three primitives:
//
//   backupIfNeeded(target):  capture the current on-disk config *before*
//                            we mutate it. Skip when the active marker
//                            already exists (means a previous start
//                            never finished restoring — the on-disk file
//                            is already our polluted version).
//
//   restoreOnStop(target):   undo the mutation: copy backup back over
//                            the config, then remove the marker.
//                            Safe to call even when the backup or the
//                            marker is missing (no-op).
//
//   restoreIfDirty(target):  startup-time self-heal. Run on app boot
//                            before the renderer comes up. If the
//                            marker is still present (a previous run
//                            exited abnormally), restore the backup.
//                            This is the layer that catches SIGKILL,
//                            power loss, and `kill -9` — everything
//                            that skips `before-quit` entirely.
//
// The marker file is just a sentinel that records which app wrote it
// (currently always "claude-code" or "codex"). We don't put structured
// state in it; the durable files (.dialogueviz-upstream,
// .dialogueviz-secret, the backup) are the source of truth.

import { copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type GuardTarget = 'claude-code' | 'codex';

interface Paths {
  /** Marker file that signals "a capture is in progress or crashed". */
  marker: string;
  /** Live config file we mutate. */
  config: string;
  /** Full-copy backup of the original config. */
  backup: string;
  /** Optional durable upstream URL file (already exists in main for
   *  the proxy secret / codex upstream; passed in so this module
   *  doesn't have to know about every helper). */
  durableUpstream?: string;
}

/** Best-effort file copy that tolerates missing source or destination
 *  by skipping silently — configGuard's callers wrap every operation
 *  in try/catch and don't want noisy logs for nonexistent files. */
function safeCopy(src: string, dst: string): boolean {
  try {
    if (!existsSync(src)) return false;
    copyFileSync(src, dst);
    return true;
  } catch {
    return false;
  }
}

function safeWrite(path: string, content: string): boolean {
  try {
    writeFileSync(path, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function safeDelete(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch { /* ignore */ }
}

function safeRead(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/** Returns true when a capture is currently in progress (marker
 *  present). Used by callers that want to know whether restoring
 *  might still be needed. */
export function isCaptureInProgress(target: GuardTarget, paths?: Paths): boolean {
  return existsSync(getPaths(target, paths).marker);
}

/** Capture the current on-disk config *before* the caller mutates it.
 *  No-op when the marker already exists (a previous capture never
 *  restored cleanly — the on-disk file is already our polluted
 *  version, so backing it up now would overwrite the real original).
 *  No-op when the config file doesn't exist yet.
 *
 *  Returns true when a fresh backup was actually written. */
export function backupIfNeeded(target: GuardTarget, paths?: Paths): boolean {
  const p = getPaths(target, paths);
  if (existsSync(p.marker)) {
    // Marker present means we're inside an active capture; the
    // existing backup (if any) is the real original. Don't
    // overwrite it.
    return false;
  }
  if (!existsSync(p.config)) {
    // Nothing to back up yet — caller may still write the marker
    // so a subsequent crash can at least detect a stale state.
    return false;
  }
  const ok = safeCopy(p.config, p.backup);
  if (ok) {
    safeWrite(p.marker, target);
  }
  return ok;
}

/** Inverse of backupIfNeeded. Restore the backup over the config,
 *  then drop the marker. Safe to call when the backup is missing
 *  (just clears the marker) or when the marker is missing
 *  (nothing to clean up). */
export function restoreOnStop(target: GuardTarget, paths?: Paths): boolean {
  const p = getPaths(target, paths);
  const restored = safeCopy(p.backup, p.config);
  safeDelete(p.backup);
  safeDelete(p.marker);
  return restored;
}

/** Startup-time self-heal. If the marker is still present from a
 *  previous run that exited abnormally (crash, SIGKILL, power
 *  loss), restore the backup. Called from app.whenReady before the
 *  renderer comes up. */
export function restoreIfDirty(target: GuardTarget, paths?: Paths): boolean {
  const p = getPaths(target, paths);
  if (!existsSync(p.marker)) return false;
  return restoreOnStop(target, p);
}

/** Same as restoreIfDirty but for both targets. Called once at
 *  startup so a single boot recovers whichever config was left
 *  dirty. */
export function restoreAllDirty(paths?: { 'claude-code'?: Paths; codex?: Paths }): void {
  restoreIfDirty('claude-code', paths?.['claude-code']);
  restoreIfDirty('codex', paths?.codex);
}

/** Same as restoreOnStop but for both targets. Called from
 *  before-quit as the normal-exit fast path; restoreAllDirty on
 *  next boot is the SIGKILL safety net. */
export function restoreAllOnStop(paths?: { 'claude-code'?: Paths; codex?: Paths }): void {
  restoreOnStop('claude-code', paths?.['claude-code']);
  restoreOnStop('codex', paths?.codex);
}

function getPaths(target: GuardTarget, override?: Paths): Paths {
  if (override) return override;
  if (target === 'claude-code') {
    const claudeDir = join(homedir(), '.claude');
    return {
      marker: join(claudeDir, '.dialogueviz-active'),
      config: join(claudeDir, 'settings.json'),
      backup: join(claudeDir, '.dialogueviz-settings.bak'),
      durableUpstream: join(claudeDir, '.dialogueviz-upstream'),
    };
  }
  const codexDir = join(homedir(), '.codex');
  return {
    marker: join(codexDir, '.dialogueviz-active'),
    config: join(codexDir, 'config.toml'),
    backup: join(codexDir, '.dialogueviz-config.bak'),
    durableUpstream: join(codexDir, '.dialogueviz-upstream'),
  };
}

/** Test-only helper to inspect the raw backup contents. Exported so
 *  unit tests can assert what got captured without going through
 *  the filesystem. */
export function _debugReadBackup(target: GuardTarget, paths?: Paths): string | null {
  return safeRead(getPaths(target, paths).backup);
}