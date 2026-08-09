import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  backupIfNeeded,
  restoreOnStop,
  restoreIfDirty,
  isCaptureInProgress,
  restoreAllDirty,
  restoreAllOnStop,
  _debugReadBackup,
} from '../../src/main/configGuard';

function makePaths(root: string) {
  const claudeDir = join(root, '.claude');
  const codexDir = join(root, '.codex');
  return {
    'claude-code': {
      marker: join(claudeDir, '.dialogueviz-active'),
      config: join(claudeDir, 'settings.json'),
      backup: join(claudeDir, '.dialogueviz-settings.bak'),
      durableUpstream: join(claudeDir, '.dialogueviz-upstream'),
    },
    codex: {
      marker: join(codexDir, '.dialogueviz-active'),
      config: join(codexDir, 'config.toml'),
      backup: join(codexDir, '.dialogueviz-config.bak'),
      durableUpstream: join(codexDir, '.dialogueviz-upstream'),
    },
  };
}

describe('configGuard', () => {
  let tmpRoot: string;
  let paths: ReturnType<typeof makePaths>;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'dialogueviz-guard-'));
    paths = makePaths(tmpRoot);
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function seedConfig(target: 'claude-code' | 'codex', content: string): void {
    mkdirSync(join(paths[target].config, '..'), { recursive: true });
    writeFileSync(paths[target].config, content, 'utf-8');
  }

  function readConfig(target: 'claude-code' | 'codex'): string {
    return readFileSync(paths[target].config, 'utf-8');
  }

  describe('backupIfNeeded', () => {
    it('copies the live config into the backup slot and drops the marker', () => {
      seedConfig('claude-code', '{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}');
      const wrote = backupIfNeeded('claude-code', paths['claude-code']);
      expect(wrote).toBe(true);
      expect(existsSync(paths['claude-code'].backup)).toBe(true);
      expect(readFileSync(paths['claude-code'].backup, 'utf-8'))
        .toBe('{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}');
      expect(isCaptureInProgress('claude-code', paths['claude-code'])).toBe(true);
    });

    it('is a no-op when the marker is already present (we are mid-capture)', () => {
      seedConfig('claude-code', 'ORIGINAL');
      backupIfNeeded('claude-code', paths['claude-code']);
      // Caller pollutes the live config.
      seedConfig('claude-code', 'POLLUTED');
      // Second backupIfNeeded inside the same capture must NOT
      // overwrite the existing backup with the polluted value.
      const wrote = backupIfNeeded('claude-code', paths['claude-code']);
      expect(wrote).toBe(false);
      expect(_debugReadBackup('claude-code', paths['claude-code'])).toBe('ORIGINAL');
    });

    it('is a no-op when no config file exists yet', () => {
      expect(backupIfNeeded('claude-code', paths['claude-code'])).toBe(false);
      expect(isCaptureInProgress('claude-code', paths['claude-code'])).toBe(false);
    });

    it('handles both claude-code and codex targets independently', () => {
      seedConfig('claude-code', 'CLAUDE_CONFIG');
      seedConfig('codex', 'base_url = "https://api.openai.com"');
      backupIfNeeded('claude-code', paths['claude-code']);
      backupIfNeeded('codex', paths['codex']);
      expect(_debugReadBackup('claude-code', paths['claude-code'])).toBe('CLAUDE_CONFIG');
      expect(_debugReadBackup('codex', paths['codex'])).toBe('base_url = "https://api.openai.com"');
    });
  });

  describe('restoreOnStop', () => {
    it('copies backup back over config and clears the marker', () => {
      seedConfig('claude-code', 'ORIGINAL');
      backupIfNeeded('claude-code', paths['claude-code']);
      seedConfig('claude-code', 'POLLUTED');
      const restored = restoreOnStop('claude-code', paths['claude-code']);
      expect(restored).toBe(true);
      expect(readConfig('claude-code')).toBe('ORIGINAL');
      expect(existsSync(paths['claude-code'].backup)).toBe(false);
      expect(isCaptureInProgress('claude-code', paths['claude-code'])).toBe(false);
    });

    it('is safe to call when there is nothing to restore', () => {
      // No backup, no marker. Should not throw, return false.
      expect(restoreOnStop('claude-code', paths['claude-code'])).toBe(false);
    });

    it('drops the marker even if the backup is missing', () => {
      seedConfig('claude-code', 'POLLUTED');
      writeFileSync(paths['claude-code'].marker, 'claude-code', 'utf-8');
      restoreOnStop('claude-code', paths['claude-code']);
      expect(existsSync(paths['claude-code'].marker)).toBe(false);
      // Live config is left alone when no backup exists — that's
      // acceptable because the user never had a chance to back up
      // and startup self-heal can't do anything without one either.
      expect(readConfig('claude-code')).toBe('POLLUTED');
    });
  });

  describe('restoreIfDirty (startup-time self-heal)', () => {
    it('returns false and does nothing when no marker is present', () => {
      seedConfig('claude-code', 'whatever');
      expect(restoreIfDirty('claude-code', paths['claude-code'])).toBe(false);
      expect(readConfig('claude-code')).toBe('whatever');
    });

    it('restores when marker is present but backup is missing (drops marker anyway)', () => {
      seedConfig('claude-code', 'POLLUTED');
      writeFileSync(paths['claude-code'].marker, 'claude-code', 'utf-8');
      expect(restoreIfDirty('claude-code', paths['claude-code'])).toBe(false);
      expect(existsSync(paths['claude-code'].marker)).toBe(false);
    });

    it('restores when both marker and backup are present', () => {
      seedConfig('claude-code', 'ORIGINAL');
      backupIfNeeded('claude-code', paths['claude-code']);
      seedConfig('claude-code', 'POLLUTED');
      expect(restoreIfDirty('claude-code', paths['claude-code'])).toBe(true);
      expect(readConfig('claude-code')).toBe('ORIGINAL');
      expect(existsSync(paths['claude-code'].marker)).toBe(false);
    });

    it('simulates a crash: original config snapshot survives a "restart"', () => {
      // First session: backup + pollute + crash (no restoreOnStop).
      seedConfig('claude-code', '{"original":true}');
      backupIfNeeded('claude-code', paths['claude-code']);
      seedConfig('claude-code', '{"polluted":true,"ANTHROPIC_BASE_URL":"http://localhost:8787"}');

      // Second session: boot-time self-heal.
      const restored = restoreIfDirty('claude-code', paths['claude-code']);
      expect(restored).toBe(true);
      expect(readConfig('claude-code')).toBe('{"original":true}');
    });
  });

  describe('restoreAllDirty / restoreAllOnStop', () => {
    it('handles both targets in one call without leaking state', () => {
      seedConfig('claude-code', 'CLAUDE_ORIG');
      seedConfig('codex', 'CODEX_ORIG');
      backupIfNeeded('claude-code', paths['claude-code']);
      backupIfNeeded('codex', paths['codex']);
      seedConfig('claude-code', 'CLAUDE_POLLUTED');
      seedConfig('codex', 'CODEX_POLLUTED');

      restoreAllDirty(paths);
      expect(readConfig('claude-code')).toBe('CLAUDE_ORIG');
      expect(readConfig('codex')).toBe('CODEX_ORIG');
      expect(isCaptureInProgress('claude-code', paths['claude-code'])).toBe(false);
      expect(isCaptureInProgress('codex', paths['codex'])).toBe(false);
    });

    it('only restores the dirty target when one is clean', () => {
      // claude: clean (no marker). codex: dirty (marker present).
      seedConfig('claude-code', 'CLAUDE_CLEAN');
      seedConfig('codex', 'CODEX_ORIG');
      backupIfNeeded('codex', paths['codex']);
      seedConfig('codex', 'CODEX_POLLUTED');

      restoreAllDirty(paths);
      expect(readConfig('claude-code')).toBe('CLAUDE_CLEAN');
      expect(readConfig('codex')).toBe('CODEX_ORIG');
    });
  });
});