/**
 * Settings store.
 *
 * A small JSON file in the OS user-data directory. The renderer edits these
 * via IPC; the main process reads them when configuring the indexer.
 *
 * Analysis runs entirely on-device since phase 2, so there is no provider,
 * API key or model to configure. Settings files written during the key era
 * are silently stripped of that material on load (see `load`).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppSettings } from '@shared/types';

let settingsPath: string | null = null;
let cache: AppSettings | null = null;

export const DEFAULT_SETTINGS: AppSettings = {
  aiEnabled: true,
  ocrEnabled: true,
  maxFileSizeMB: 50,
  excludePatterns: ['node_modules', '.git', '.next', 'dist', 'out', '.cache', '__pycache__', 'venv'],
};

/** Fields retired in phase 2; removed from stored settings on load. */
const RETIRED_KEYS = ['provider', 'apiKey', 'model'] as const;

export function initSettings(userDataDir: string): void {
  settingsPath = join(userDataDir, 'settings.json');
  cache = load();
}

function load(): AppSettings {
  if (!settingsPath) return { ...DEFAULT_SETTINGS };
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings> & Record<string, unknown>;

    // Privacy: settings.json from the key era may still hold an API key.
    // Drop the retired fields and rewrite the file without them.
    const hadRetired = RETIRED_KEYS.some((k) => k in parsed);
    for (const k of RETIRED_KEYS) delete parsed[k];

    const merged: AppSettings = { ...DEFAULT_SETTINGS, ...parsed };
    if (hadRetired) {
      writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function getSettings(): AppSettings {
  if (!cache) cache = load();
  return { ...cache };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };
  cache = next;
  if (settingsPath) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(next, null, 2), 'utf8');
  }
  return { ...next };
}
