import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ModelConfig {
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  maxContextTokens: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export type ProviderType = 'deepseek' | 'openai-compatible';

export interface AppConfig {
  provider: ProviderType;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  maxLoops: number;
  models: ModelConfig[];
  activeModel: string;
  searchApiKey: string;
}

export const DEFAULTS: AppConfig = {
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  timeoutMs: 60_000,
  maxRetries: 2,
  maxLoops: 68,
  models: [],
  activeModel: '',
  searchApiKey: '',
};

function readJSON(path: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function shallowMerge(base: AppConfig, overrides: Record<string, unknown>): AppConfig {
  const merged = { ...base };
  for (const key of Object.keys(DEFAULTS) as (keyof AppConfig)[]) {
    if (key === 'models') continue; // models 由 mergeModels 单独处理
    if (key in overrides && overrides[key] !== undefined && overrides[key] !== null) {
      (merged as Record<string, unknown>)[key] = overrides[key];
    }
  }
  return merged;
}

function mergeModels(base: ModelConfig[], override: unknown): ModelConfig[] {
  if (!Array.isArray(override)) return base;
  const map = new Map<string, ModelConfig>();
  for (const m of base) map.set(m.name, m);
  for (const m of override) {
    if (m && typeof m.name === 'string') map.set(m.name, m as ModelConfig);
  }
  return [...map.values()];
}

function backfillModels(config: AppConfig): AppConfig {
  if (config.models.length > 0) return config;
  return {
    ...config,
    models: [{
      name: config.model,
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      maxContextTokens: 65536,
    }],
  };
}

function applyFileOverrides(
  config: AppConfig,
  path: string,
  mergeModelsWith: ModelConfig[] | 'replace',
): AppConfig {
  const overrides = readJSON(path);
  if (!overrides) return config;
  const next = shallowMerge(config, overrides);
  if ('models' in overrides) {
    const base = mergeModelsWith === 'replace' ? [] : config.models;
    next.models = mergeModels(base, overrides.models);
  }
  return next;
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  const next = { ...config, models: config.models.map((m) => ({ ...m })) };
  const envKey = process.env.HCENT_API_KEY;
  if (envKey) {
    next.apiKey = envKey;
    for (const m of next.models) m.apiKey = envKey;
  }
  const envModel = process.env.HCENT_MODEL;
  if (envModel) {
    next.model = envModel;
    next.activeModel = envModel;
  }
  if (process.env.HCENT_BASE_URL) next.baseUrl = process.env.HCENT_BASE_URL;
  if (process.env.HCENT_SEARCH_API_KEY) next.searchApiKey = process.env.HCENT_SEARCH_API_KEY;
  return next;
}

export function loadConfig(cwd: string): AppConfig {
  let config = applyFileOverrides(
    { ...DEFAULTS },
    join(homedir(), '.hcent', 'config.json'),
    'replace',
  );
  config = applyFileOverrides(config, join(cwd, '.hcent', 'config.json'), config.models);
  config = applyEnvOverrides(config);
  config = backfillModels(config);
  if (!config.activeModel && config.models.length > 0) {
    config.activeModel = config.models[0]!.name;
  }
  return config;
}

export function sanitizeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    apiKey: config.apiKey ? '***' : '',
    models: config.models.map((m) => ({ ...m, apiKey: m.apiKey ? '***' : '' })),
  };
}
