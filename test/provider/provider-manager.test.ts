import { describe, it, expect } from 'vitest';
import { createProviderManager } from '@/provider/provider-manager.js';
import type { AppConfig, ModelConfig } from '@/config/index.js';

function makeModelConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    name: 'test-model',
    model: 'deepseek-v4-pro',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    maxContextTokens: 65536,
    ...overrides,
  };
}

function makeConfig(modelOverrides?: Partial<ModelConfig>[]): AppConfig {
  const models = modelOverrides
    ? modelOverrides.map((o) => makeModelConfig(o))
    : [makeModelConfig()];
  return {
    provider: 'deepseek',
    model: models[0].model,
    baseUrl: models[0].baseUrl,
    apiKey: models[0].apiKey,
    timeoutMs: 60_000,
    maxRetries: 0,
    maxLoops: 25,
    models,
    activeModel: models[0].name,
    searchApiKey: '',
  };
}

describe('ProviderManager', () => {
  it('creates with active model config', () => {
    const pm = createProviderManager(makeConfig());
    expect(pm.activeModelConfig.name).toBe('test-model');
    expect(pm.current.model).toBe('deepseek-v4-pro');
  });

  it('listModels returns all models with redacted apiKeys', () => {
    const pm = createProviderManager(makeConfig([
      { name: 'm1', apiKey: 'sk-1' },
      { name: 'm2', apiKey: 'sk-2' },
    ]));
    const list = pm.listModels();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('m1');
    expect(list[0].apiKey).toBe('***');
    expect(list[1].name).toBe('m2');
    expect(list[1].apiKey).toBe('***');
  });

  it('switch changes active model and provider', () => {
    const pm = createProviderManager(makeConfig([
      { name: 'm1', model: 'model-1', apiKey: 'sk-1' },
      { name: 'm2', model: 'model-2', apiKey: 'sk-2' },
    ]));

    expect(pm.activeModelConfig.name).toBe('m1');
    expect(pm.current.model).toBe('model-1');

    pm.switch('m2');

    expect(pm.activeModelConfig.name).toBe('m2');
    expect(pm.current.model).toBe('model-2');
  });

  it('switch throws for nonexistent model name', () => {
    const pm = createProviderManager(makeConfig());
    expect(() => pm.switch('nonexistent')).toThrow('模型 nonexistent 不存在');
  });

  it('switch preserves activeModelConfig after error', () => {
    const pm = createProviderManager(makeConfig());
    try {
      pm.switch('nonexistent');
    } catch {
      // expected
    }
    expect(pm.activeModelConfig.name).toBe('test-model');
    expect(pm.current.model).toBe('deepseek-v4-pro');
  });
});
