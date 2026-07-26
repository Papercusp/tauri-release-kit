import { describe, it, expect, beforeEach } from 'vitest';
import { runIncrementalPublish, type HttpGetPort } from './incremental-publish.js';
import { registerTargetDriver, clearTargetDrivers } from './registry.js';
import type {
  Artifact,
  ExecPort,
  ExecResult,
  FsPort,
  ReleasePorts,
  TargetDriver,
  TauriReleaseConfig,
} from './types.js';

const ROOT = '/repo/papercusp-desktop';

class MemFs implements FsPort {
  files = new Map<string, string>();
  constructor(seed: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(seed)) this.files.set(k, v);
  }
  async readText(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  }
  async writeText(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async readDir(dir: string): Promise<string[]> {
    const prefix = dir.endsWith('/') ? dir : dir + '/';
    const names = new Set<string>();
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        if (!rest.includes('/')) names.add(rest);
      }
    }
    return [...names];
  }
  async mkdir(): Promise<void> {}
}

function makePorts(fs: MemFs): ReleasePorts {
  const exec: ExecPort = {
    async run(): Promise<ExecResult> {
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return {
    exec,
    fs,
    log: { info: () => {}, warn: () => {} },
    env: () => undefined,
    now: () => '2026-07-26T00:00:00.000Z',
  };
}

/** A fake driver that "builds" one signed macOS artifact, no real process work. */
const fakeDarwinDriver: TargetDriver = {
  key: 'macos-universal',
  async build(cfg): Promise<Artifact[]> {
    const path = `${cfg.root}/out/Papercusp_${cfg.version}_universal.app.tar.gz`;
    return [
      {
        path,
        name: `Papercusp_${cfg.version}_universal.app.tar.gz`,
        platformKey: 'darwin-universal',
        sigPath: `${path}.sig`,
      },
    ];
  },
};

function makeConfig(overrides: Partial<TauriReleaseConfig> = {}): TauriReleaseConfig {
  return {
    appName: 'Papercusp',
    appId: 'com.papercusp.desktop',
    root: ROOT,
    repo: { owner: 'Papercusp', name: 'papercusp-desktop' },
    version: '0.0.13',
    channel: 'alpha',
    versionFiles: [],
    targets: ['macos-universal'],
    signing: { keyPath: '/key' },
    buildSidecar: async () => {},
    latestJsonUrl: ({ tag, name }) => `https://dl.example.com/secret/${tag}/${encodeURIComponent(name)}`,
    ...overrides,
  };
}

function fakeHttp(responses: Record<string, string | null>): HttpGetPort {
  return {
    async getText(url) {
      return Object.prototype.hasOwnProperty.call(responses, url) ? responses[url] : null;
    },
  };
}

describe('runIncrementalPublish (end-to-end with fakes)', () => {
  beforeEach(() => {
    clearTargetDrivers();
    registerTargetDriver(fakeDarwinDriver);
  });

  it('merges a new platform onto an already-live manifest, leaving the other platform untouched', async () => {
    const fs = new MemFs({
      [`${ROOT}/out/Papercusp_0.0.13_universal.app.tar.gz`]: 'BIN',
      [`${ROOT}/out/Papercusp_0.0.13_universal.app.tar.gz.sig`]: 'MAC_SIG_BASE64\n',
    });
    const ports = makePorts(fs);
    const liveManifest = {
      version: '0.0.13',
      channel: 'alpha',
      notes: 'old notes',
      pub_date: '2026-07-20T00:00:00.000Z',
      platforms: {
        'linux-x86_64': {
          signature: 'LINUX_SIG',
          url: 'https://dl.example.com/secret/desktop-v0.0.13-alpha/App.AppImage',
        },
      },
    };
    const http = fakeHttp({
      'https://dl.example.com/secret/latest.json': JSON.stringify(liveManifest),
    });

    const res = await runIncrementalPublish(makeConfig(), 'macos-universal', ports, {
      liveManifestUrl: 'https://dl.example.com/secret/latest.json',
      http,
    });

    expect(res.mergedFrom).toBe('live');
    expect(res.tag).toBe('desktop-v0.0.13-alpha');
    // the already-live linux entry survives byte-for-byte
    expect(res.manifest.platforms['linux-x86_64']).toEqual(liveManifest.platforms['linux-x86_64']);
    // the new darwin entry is added, signature read VERBATIM (no re-encode)
    expect(res.manifest.platforms['darwin-universal']).toEqual({
      signature: 'MAC_SIG_BASE64',
      url: 'https://dl.example.com/secret/desktop-v0.0.13-alpha/Papercusp_0.0.13_universal.app.tar.gz',
    });
    // metadata reflects THIS publish, not the stale live one
    expect(res.manifest.pub_date).toBe('2026-07-26T00:00:00.000Z');

    // only the new platform's artifact was built — the linux one was NOT rebuilt
    expect(res.artifacts).toHaveLength(1);
    expect(res.artifacts[0].platformKey).toBe('darwin-universal');

    // written to disk
    const written = JSON.parse(await fs.readText(`${ROOT}/latest.json`));
    expect(written).toEqual(res.manifest);
  });

  it('starts fresh (mergedFrom: none) when nothing is live yet — first publish of a release', async () => {
    const fs = new MemFs({
      [`${ROOT}/out/Papercusp_0.0.13_universal.app.tar.gz`]: 'BIN',
      [`${ROOT}/out/Papercusp_0.0.13_universal.app.tar.gz.sig`]: 'MAC_SIG\n',
    });
    const ports = makePorts(fs);
    const http = fakeHttp({}); // unreachable / 404 → null

    const res = await runIncrementalPublish(makeConfig(), 'macos-universal', ports, {
      liveManifestUrl: 'https://dl.example.com/secret/latest.json',
      http,
    });

    expect(res.mergedFrom).toBe('none');
    expect(Object.keys(res.manifest.platforms)).toEqual(['darwin-universal']);
  });

  it('starts fresh when the live manifest is unparseable garbage rather than throwing', async () => {
    const fs = new MemFs({
      [`${ROOT}/out/Papercusp_0.0.13_universal.app.tar.gz`]: 'BIN',
      [`${ROOT}/out/Papercusp_0.0.13_universal.app.tar.gz.sig`]: 'MAC_SIG\n',
    });
    const ports = makePorts(fs);
    const http = fakeHttp({ 'https://dl.example.com/secret/latest.json': 'not json{{{' });

    const res = await runIncrementalPublish(makeConfig(), 'macos-universal', ports, {
      liveManifestUrl: 'https://dl.example.com/secret/latest.json',
      http,
    });

    expect(res.mergedFrom).toBe('none');
    expect(Object.keys(res.manifest.platforms)).toEqual(['darwin-universal']);
  });

  it('rejects an invalid version before building anything', async () => {
    const fs = new MemFs();
    const ports = makePorts(fs);
    const http = fakeHttp({});
    await expect(
      runIncrementalPublish(makeConfig({ version: 'nope' }), 'macos-universal', ports, {
        liveManifestUrl: 'https://dl.example.com/secret/latest.json',
        http,
      }),
    ).rejects.toThrow(/invalid version/);
  });

  it('throws when the platform driver produces no updater-eligible artifact', async () => {
    clearTargetDrivers();
    registerTargetDriver({
      key: 'macos-universal',
      async build(cfg): Promise<Artifact[]> {
        // e.g. a .dmg-only build with no platformKey classified
        return [{ path: `${cfg.root}/out/x.dmg`, name: 'x.dmg' }];
      },
    });
    const fs = new MemFs({ [`${ROOT}/out/x.dmg`]: 'BIN' });
    const ports = makePorts(fs);
    const http = fakeHttp({});
    await expect(
      runIncrementalPublish(makeConfig(), 'macos-universal', ports, {
        liveManifestUrl: 'https://dl.example.com/secret/latest.json',
        http,
      }),
    ).rejects.toThrow(/nothing to merge/);
  });
});
