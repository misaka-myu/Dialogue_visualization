// src/main/proxy/upstream.ts
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Detect the upstream Anthropic API base URL.
 *
 * Reads `~/.claude/settings.json` and looks for `env.ANTHROPIC_BASE_URL`.
 * If the file or the field does not exist, falls back to the official endpoint.
 *
 * The returned string has NO trailing slash so callers can safely do
 * `${upstream}/v1/messages`.
 */
export function detectUpstream(): string {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  try {
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw) as { env?: Record<string, string> };
      const base = settings.env?.ANTHROPIC_BASE_URL;
      if (base && typeof base === 'string') {
        return base.replace(/\/+$/, '');
      }
    }
  } catch {
    // ignore - fall through to default
  }
  return 'https://api.anthropic.com';
}
