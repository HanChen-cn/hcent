import type { AppConfig, ModelConfig } from '../config/index.js';
import { type Provider, createOpenAICompatibleProvider } from './index.js';

export interface ProviderManager {
  readonly current: Provider;
  readonly activeModelConfig: ModelConfig;
  switch(name: string): void;
  listModels(): ModelConfig[];
}

export function createProviderManager(config: AppConfig): ProviderManager {
  let activeConfig = findModel(config, config.activeModel);
  let provider = createProvider(activeConfig);

  function findModel(cfg: AppConfig, name: string): ModelConfig {
    const found = cfg.models.find((m) => m.name === name);
    if (!found) throw new Error(`模型 ${name} 不存在`);
    return found;
  }

  function createProvider(mc: ModelConfig): Provider {
    const providerConfig: AppConfig = {
      ...config,
      model: mc.model,
      baseUrl: mc.baseUrl,
      apiKey: mc.apiKey,
      timeoutMs: mc.timeoutMs ?? config.timeoutMs,
      maxRetries: mc.maxRetries ?? config.maxRetries,
    };
    switch (config.provider) {
      case 'openai-compatible':
      case 'deepseek':
      default:
        return createOpenAICompatibleProvider(providerConfig);
    }
  }

  return {
    get current() {
      return provider;
    },
    get activeModelConfig() {
      return activeConfig;
    },
    switch(name: string) {
      activeConfig = findModel(config, name);
      provider = createProvider(activeConfig);
    },
    listModels() {
      return config.models.map((m) => ({ ...m, apiKey: m.apiKey ? '***' : '' }));
    },
  };
}
