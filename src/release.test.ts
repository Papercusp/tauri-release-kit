import { describe, it, expect, beforeEach } from 'vitest';
import { runRelease } from './release.js';
import { registerTargetDriver, clearTargetDrivers } from './registry.js';
import { linuxX86Driver } from './drivers/linux.js';
import type { ExecPort, ExecResult, FsPort, ReleasePorts, TauriReleaseConfig } from './types.js';

const ROOT = '/repo/papercusp-desktop';

class MemFs implements FsPort {
  files = new Map<string, string>();
  constructor(seed: Record<string, string>) {
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
}

function makePorts(fs: MemFs, calls: string[][]): ReleasePorts {
  const exec: ExecPort = {
    async run(cmd, args): Promise<ExecResult> {
      calls.push([cmd, ...args]);
      // gh release view → "not found" so the create path is exercised
      if (cmd === 'gh' && args[1] === 'view') return { code: 1, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return {
    exec,
    fs,
    log: { info: () => {}, warn: () => {} },
    env: (n) => (n === 'PW' ? '' : undefined),
    now: () => '2026-06-25T00:00:00.000Z',
  };
}

function seedFs(): MemFs {
  return new MemFs({
    [`${ROOT}/package.json`]: JSON.stringify({ name: '@papercusp/desktop', version: '0.0.1' }, null, 2) + '\n',
    [`${ROOT}/src-tauri/tauri.conf.json`]: JSON.stringify({ version: '0.0.1' }, null, 2) + '\n',
    [`${ROOT}/src-tauri/Cargo.toml`]: '[package]\nname = "app"\nversion = "0.0.1"\n',
    [`${ROOT}/src-tauri/target/release/bundle/appimage/Papercusp_0.0.2_amd64.AppImage`]: 'BIN',
    [`${ROOT}/src-tauri/target/release/bundle/appimage/Papercusp_0.0.2_amd64.AppImage.sig`]: 'SIGDATA\n',
    [`${ROOT}/src-tauri/target/release/bundle/deb/papercusp_0.0.2_amd64.deb`]: 'DEB',
  });
}

function makeConfig(overrides: Partial<TauriReleaseConfig> = {}): TauriReleaseConfig {
  return {
    appName: 'Papercusp',
    appId: 'com.papercusp.desktop',
    root: ROOT,
    repo: { owner: 'Papercusp', name: 'papercusp-desktop' },
    version: '0.0.2',
    channel: 'stable',
    versionFiles: [
      { path: 'package.json', kind: 'json' },
      { path: 'src-tauri/tauri.conf.json', kind: 'json' },
      { path: 'src-tauri/Cargo.toml', kind: 'cargo-toml' },
    ],
    targets: ['linux-x86_64'],
    signing: { keyPath: '/key', passwordEnv: 'PW' },
    buildSidecar: async () => {},
    latestJsonUrl: ({ tag, name }) =>
      `https://github.com/Papercusp/papercusp-desktop/releases/download/${tag}/${name}`,
    ...overrides,
  };
}

describe('runRelease (end-to-end with fakes)', () => {
  beforeEach(() => {
    clearTargetDrivers();
    registerTargetDriver(linuxX86Driver);
  });

  it('bumps versions, builds, signs, writes latest.json, and publishes', async () => {
    const fs = seedFs();
    const calls: string[][] = [];
    const ports = makePorts(fs, calls);
    let sidecarCalled = false;
    const cfg = makeConfig({ buildSidecar: async () => { sidecarCalled = true; } });

    const res = await runRelease(cfg, ports);

    // version bumped in all three files
    expect(JSON.parse(await fs.readText(`${ROOT}/package.json`)).version).toBe('0.0.2');
    expect(JSON.parse(await fs.readText(`${ROOT}/src-tauri/tauri.conf.json`)).version).toBe('0.0.2');
    expect(await fs.readText(`${ROOT}/src-tauri/Cargo.toml`)).toContain('version = "0.0.2"');

    // sidecar seam invoked
    expect(sidecarCalled).toBe(true);

    // tag + manifest
    expect(res.tag).toBe('desktop-v0.0.2');
    expect(res.manifest.platforms['linux-x86_64']).toEqual({
      signature: 'SIGDATA',
      url: 'https://github.com/Papercusp/papercusp-desktop/releases/download/desktop-v0.0.2/Papercusp_0.0.2_amd64.AppImage',
    });
    expect(res.manifest.pub_date).toBe('2026-06-25T00:00:00.000Z');

    // latest.json written
    expect(await fs.exists(`${ROOT}/latest.json`)).toBe(true);

    // the .deb is collected but is not an updater platform
    const deb = res.artifacts.find((a) => a.name.endsWith('.deb'));
    expect(deb).toBeDefined();
    expect(deb!.platformKey).toBeUndefined();

    // git + gh ran; stable → no --prerelease
    const flat = calls.map((c) => c.join(' '));
    expect(flat.some((c) => c.startsWith('git -C ' + ROOT + ' tag -f desktop-v0.0.2'))).toBe(true);
    expect(flat.some((c) => c.includes('git -C ' + ROOT + ' push origin HEAD desktop-v0.0.2'))).toBe(true);
    expect(res.published?.action).toBe('created');
    expect(flat.some((c) => c.includes('release create') && c.includes('--prerelease'))).toBe(false);
  });

  it('skipGit + skipPublish do a build-only dry run (parity check mode)', async () => {
    const fs = seedFs();
    const calls: string[][] = [];
    const ports = makePorts(fs, calls);
    const res = await runRelease(makeConfig(), ports, { skipGit: true, skipPublish: true });
    const flat = calls.map((c) => c.join(' '));
    expect(flat.some((c) => c.startsWith('git'))).toBe(false);
    expect(flat.some((c) => c.startsWith('gh'))).toBe(false);
    expect(res.published).toBeUndefined();
    // still produced the manifest + bumped versions
    expect(res.manifest.platforms['linux-x86_64'].signature).toBe('SIGDATA');
  });

  it('alpha channel tags + marks prerelease', async () => {
    const fs = seedFs();
    const calls: string[][] = [];
    const ports = makePorts(fs, calls);
    const res = await runRelease(makeConfig({ channel: 'alpha' }), ports);
    expect(res.tag).toBe('desktop-v0.0.2-alpha');
    const flat = calls.map((c) => c.join(' '));
    expect(flat.some((c) => c.includes('release create') && c.includes('--prerelease'))).toBe(true);
  });

  it('rejects an invalid version before doing anything', async () => {
    const fs = seedFs();
    const ports = makePorts(fs, []);
    await expect(runRelease(makeConfig({ version: 'nope' }), ports)).rejects.toThrow(/invalid version/);
  });
});
