import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, sep  } from 'node:path';
import { tmpdir } from 'node:os';

// We import after setting up test fixtures
const configMod = await import('@/config/index.js');

function tmpDir() {
  const dir = join(tmpdir(), `tui-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('loadConfig', () => {
  const origEnv = process.env.HCENT_API_KEY;
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  let fakeHome: string;

  beforeEach(() => {
    delete process.env.HCENT_API_KEY;
    fakeHome = tmpDir();
    if (sep === '\\') {
      process.env.USERPROFILE = fakeHome;
    } else {
      process.env.HOME = fakeHome;
    }
  });

  afterEach(() => {
    if (origEnv) process.env.HCENT_API_KEY = origEnv;
    else delete process.env.HCENT_API_KEY;
    if (origHome) process.env.HOME = origHome;
    else delete process.env.HOME;
    if (origUserProfile) process.env.USERPROFILE = origUserProfile;
    else delete process.env.USERPROFILE;
    if (fakeHome) rmSync(fakeHome, { recursive: true, force: true });
  });

  it('returns defaults when no config files exist', () => {
    const cwd = tmpDir();
    try {
      const cfg = configMod.loadConfig(cwd);
      expect(cfg.provider).toBe('deepseek');
      expect(cfg.model).toBe('deepseek-v4-pro');
      expect(cfg.baseUrl).toBe('https://api.deepseek.com');
      expect(cfg.timeoutMs).toBe(60_000);
      expect(cfg.maxRetries).toBe(2);
      expect(cfg.maxLoops).toBe(68);
      expect(cfg.apiKey).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('merges project-level config over defaults', () => {
    const cwd = tmpDir();
    try {
      const agentDir = join(cwd, '.hcent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, 'config.json'), JSON.stringify({ model: 'deepseek-v3', maxLoops: 10 }));

      const cfg = configMod.loadConfig(cwd);
      expect(cfg.model).toBe('deepseek-v3');
      expect(cfg.maxLoops).toBe(10);
      // other fields remain defaults
      expect(cfg.timeoutMs).toBe(60_000);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('env var API key takes highest priority', () => {
    process.env.HCENT_API_KEY = 'sk-env-key';
    const cwd = tmpDir();
    try {
      const agentDir = join(cwd, '.hcent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, 'config.json'), JSON.stringify({ apiKey: 'sk-project-key' }));

      const cfg = configMod.loadConfig(cwd);
      expect(cfg.apiKey).toBe('sk-env-key');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('project-level overrides user-level (project priority test)', () => {
    const cwd = tmpDir();
    // simulate user-level config by setting HOME to a temp dir
    const fakeHome = tmpDir();
    try {
      const userConfigDir = join(fakeHome, '.hcent');
      mkdirSync(userConfigDir, { recursive: true });
      writeFileSync(join(userConfigDir, 'config.json'), JSON.stringify({ timeoutMs: 30_000 }));

      const agentDir = join(cwd, '.hcent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, 'config.json'), JSON.stringify({ timeoutMs: 90_000 }));

      // override HOME for this test
      if (sep === '\\') {
        process.env.USERPROFILE = fakeHome;
      } else {
        process.env.HOME = fakeHome;
      }

      const cfg = configMod.loadConfig(cwd);
      expect(cfg.timeoutMs).toBe(90_000); // project wins
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('handles malformed JSON gracefully', () => {
    const cwd = tmpDir();
    try {
      const agentDir = join(cwd, '.hcent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, 'config.json'), 'not json{{{');

      const cfg = configMod.loadConfig(cwd);
      // should fall back to defaults
      expect(cfg.model).toBe('deepseek-v4-pro');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

});

describe('sanitizeConfig', () => {
  it('masks apiKey', () => {
    const cfg = { ...configMod.DEFAULTS, apiKey: 'sk-secret-123' } as const;
    const s = configMod.sanitizeConfig(cfg);
    expect(s.apiKey).toBe('***');
    expect(s.model).toBe(cfg.model); // other fields unchanged
  });

  it('masks empty apiKey as empty', () => {
    const cfg = { ...configMod.DEFAULTS, apiKey: '' } as const;
    const s = configMod.sanitizeConfig(cfg);
    expect(s.apiKey).toBe('');
  });
});

describe('AppConfig type guard', () => {
  it('DEFAULTS satisfies AppConfig', () => {
    const cfg = configMod.DEFAULTS;
    // structural check
    expect(typeof cfg.provider).toBe('string');
    expect(typeof cfg.model).toBe('string');
    expect(typeof cfg.baseUrl).toBe('string');
    expect(typeof cfg.apiKey).toBe('string');
    expect(typeof cfg.timeoutMs).toBe('number');
    expect(typeof cfg.maxRetries).toBe('number');
    expect(typeof cfg.maxLoops).toBe('number');
  });
});

describe('models config', () => {
  const origModel = process.env.HCENT_MODEL;
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  let fakeHome: string;

  beforeEach(() => {
    delete process.env.HCENT_MODEL;
    fakeHome = tmpDir();
    if (sep === '\\') {
      process.env.USERPROFILE = fakeHome;
    } else {
      process.env.HOME = fakeHome;
    }
  });

  afterEach(() => {
    if (origModel) process.env.HCENT_MODEL = origModel;
    else delete process.env.HCENT_MODEL;
    if (origHome) process.env.HOME = origHome;
    else delete process.env.HOME;
    if (origUserProfile) process.env.USERPROFILE = origUserProfile;
    else delete process.env.USERPROFILE;
    if (fakeHome) rmSync(fakeHome, { recursive: true, force: true });
  });

  it('backfills models from top-level fields when models array is empty', () => {
    const cwd = tmpDir();
    try {
      const cfg = configMod.loadConfig(cwd);
      expect(cfg.models).toHaveLength(1);
      expect(cfg.models[0].name).toBe('deepseek-v4-pro');
      expect(cfg.models[0].model).toBe('deepseek-v4-pro');
      expect(cfg.models[0].maxContextTokens).toBe(65536);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('sets activeModel to models[0].name by default', () => {
    const cwd = tmpDir();
    try {
      const cfg = configMod.loadConfig(cwd);
      expect(cfg.activeModel).toBe(cfg.models[0].name);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('loads models array from project config', () => {
    const cwd = tmpDir();
    try {
      const agentDir = join(cwd, '.hcent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, 'config.json'), JSON.stringify({
        models: [
          { name: 'm1', model: 'model-1', baseUrl: 'http://a', apiKey: 'k1', maxContextTokens: 1000 },
          { name: 'm2', model: 'model-2', baseUrl: 'http://b', apiKey: 'k2', maxContextTokens: 2000 },
        ],
        activeModel: 'm2',
      }));

      const cfg = configMod.loadConfig(cwd);
      expect(cfg.models).toHaveLength(2);
      expect(cfg.models[0].name).toBe('m1');
      expect(cfg.models[1].name).toBe('m2');
      expect(cfg.activeModel).toBe('m2');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('deduplicates models by name, project overrides user', () => {
    const cwd = tmpDir();
    const fakeHome = tmpDir();
    try {
      const userConfigDir = join(fakeHome, '.hcent');
      mkdirSync(userConfigDir, { recursive: true });
      writeFileSync(join(userConfigDir, 'config.json'), JSON.stringify({
        models: [
          { name: 'shared', model: 'user-version', baseUrl: 'http://u', apiKey: 'ku', maxContextTokens: 1000 },
          { name: 'user-only', model: 'uo', baseUrl: 'http://u', apiKey: 'ku', maxContextTokens: 1000 },
        ],
      }));

      const agentDir = join(cwd, '.hcent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, 'config.json'), JSON.stringify({
        models: [
          { name: 'shared', model: 'project-version', baseUrl: 'http://p', apiKey: 'kp', maxContextTokens: 2000 },
        ],
      }));

      if (sep === '\\') process.env.USERPROFILE = fakeHome;
      else process.env.HOME = fakeHome;

      const cfg = configMod.loadConfig(cwd);
      expect(cfg.models).toHaveLength(2);
      const shared = cfg.models.find((m) => m.name === 'shared');
      expect(shared!.model).toBe('project-version'); // project wins
      const userOnly = cfg.models.find((m) => m.name === 'user-only');
      expect(userOnly!.model).toBe('uo');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('env var HCENT_MODEL overrides activeModel', () => {
    process.env.HCENT_MODEL = 'env-model';
    const cwd = tmpDir();
    try {
      const cfg = configMod.loadConfig(cwd);
      expect(cfg.activeModel).toBe('env-model');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('sanitizeConfig masks apiKeys in models array', () => {
    const cfg = {
      ...configMod.DEFAULTS,
      apiKey: 'sk-main',
      models: [
        { name: 'm1', model: 'm1', baseUrl: 'http://a', apiKey: 'sk-m1', maxContextTokens: 1000 },
      ],
    };
    const s = configMod.sanitizeConfig(cfg);
    expect(s.apiKey).toBe('***');
    expect(s.models[0].apiKey).toBe('***');
  });
});
