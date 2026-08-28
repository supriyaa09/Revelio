/**
 * Settings store.
 *
 * A small JSON file in the OS user-data directory. The renderer edits these via
 * IPC; the main process reads them when configuring the indexer and the AI
 * layer. An empty apiKey/model means "fall back to environment variables", so
 * a user who launches the app from a terminal with ANTHROPIC_API_KEY set never
 * has to retype it.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppSettings } from '@shared/types';

let settingsPath: string | null = null;
let cache: AppSettings | null = null;

export const DEFAULT_SETTINGS: AppSettings = {
  aiEnabled: true,
  ocrEnabled: true,
  provider: 'anthropic',
  apiKey: '',
  model: '',
  maxFileSizeMB: 50,
  excludePatterns: ['node_modules', '.git', '.next', 'dist', 'out', '.cache', '__pycache__', 'venv'],
};

export function initSettings(userDataDir: string): void {
  settingsPath = join(userDataDir, 'settings.json');
  cache = load();
}

function load(): AppSettings {
  if (!settingsPath) return { ...DEFAULT_SETTINGS };
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
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

/**
 * Builds the environment overlay the provider resolver consumes. Settings win
 * over the inherited process environment; unset settings defer to it. This is
 * what lets the in-app key field and ANTHROPIC_API_KEY coexist.
 */
export function buildAiEnv(settings: AppSettings = getSettings()): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };

  env.REVELIO_AI_PROVIDER = settings.provider;

  if (settings.apiKey.trim()) {
    if (settings.provider === 'agentrouter') {
      env.REVELIO_AGENTROUTER_API_KEY = settings.apiKey.trim();
    } else {
      env.ANTHROPIC_API_KEY = settings.apiKey.trim();
    }
  }

  if (settings.model.trim()) {
    env.ANTHROPIC_MODEL = settings.model.trim();
    env.REVELIO_AGENTROUTER_MODEL = settings.model.trim();
  }

  return env;
}
