/**
 * Proves the kit is app-agnostic: an ODDSMITH-shaped config (different app id,
 * repo, sidecar, bundle targets) runs through the same runRelease with no kit
 * changes. This is the P-008 evidence that the kit serves oddsmith — the live
 * wiring is owner-gated (the kit must become a shared submodule, see plan).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runRelease } from './release.js';
import { registerTargetDriver, clearTargetDrivers } from './registry.js';
import { linuxX86Driver } from './drivers/linux.js';
import type { ExecPort, ExecResult, FsPort, ReleasePorts, TauriReleaseConfig } from './types.js';

const ROOT = '/oddsmith/apps/desktop';

class MemFs implements FsPort {
  files = new Map<string, string>();
  constructor(seed: Record<string, string>) {
    for (const [k, v] of Object.entries(seed)) this.files.set(k, v);
  }
  async readText(p: string) {
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  }
  async writeText(p: string, d: string) {
    this.files.set(p, d);
  }
  async exists(p: string) {
    return this.files.has(p);
  }
  async readDir(dir: string) {
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

function ports(fs: MemFs): ReleasePorts {
  const exec: ExecPort = {
    async run(cmd, args): Promise<ExecResult> {
      if (cmd === 'gh' && args[1] === 'view') return { code: 1, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return {
    exec,
    fs,
    log: { info: () => {}, warn: () => {} },
    env: () => undefined,
    now: () => '2026-06-25T00:00:00.000Z',
  };
}

describe('kit serves the oddsmith shape (P-008)', () => {
  beforeEach(() => {
    clearTargetDrivers();
    registerTargetDriver(linuxX86Driver);
  });

  it('runs an oddsmith config (deb+appimage, esbuild sidecar, aviynw/oddsmith) unchanged', async () => {
    const fs = new MemFs({
      [`${ROOT}/package.json`]: JSON.stringify({ name: '@oddsmith/desktop', version: '0.0.1' }, null, 2) + '\n',
      [`${ROOT}/src-tauri/tauri.conf.json`]: JSON.stringify({ version: '0.0.1' }, null, 2) + '\n',
      [`${ROOT}/src-tauri/Cargo.toml`]: 'version = "0.0.1"\n',
      [`${ROOT}/src-tauri/target/release/bundle/appimage/Oddsmith_0.0.2_amd64.AppImage`]: 'BIN',
      [`${ROOT}/src-tauri/target/release/bundle/appimage/Oddsmith_0.0.2_amd64.AppImage.sig`]: 'ODDSIG\n',
      [`${ROOT}/src-tauri/target/release/bundle/deb/oddsmith_0.0.2_amd64.deb`]: 'DEB',
    });

    let sidecarRan = false;
    const cfg: TauriReleaseConfig = {
      appName: 'Oddsmith',
      appId: 'com.oddsmith.desktop',
      root: ROOT,
      repo: { owner: 'aviynw', name: 'oddsmith' },
      version: '0.0.2',
      channel: 'stable',
      versionFiles: [
        { path: 'package.json', kind: 'json' },
        { path: 'src-tauri/tauri.conf.json', kind: 'json' },
        { path: 'src-tauri/Cargo.toml', kind: 'cargo-toml' },
      ],
      targets: ['linux-x86_64'],
      signing: { keyPath: '/home/me/.oddsmith/signing/oddsmith.key' },
      // oddsmith's sidecar seam = vite build + scripts/build-sidecar.mjs (esbuild)
      buildSidecar: async ({ ports: p, root }) => {
        await p.exec.run('npm', ['run', 'build:spa'], { cwd: root });
        await p.exec.run('node', ['scripts/build-sidecar.mjs'], { cwd: root });
        sidecarRan = true;
      },
      latestJsonUrl: ({ tag, name }) =>
        `https://github.com/aviynw/oddsmith/releases/download/${tag}/${name}`,
    };

    const res = await runRelease(cfg, ports(fs), { skipGit: true });

    expect(sidecarRan).toBe(true);
    expect(res.tag).toBe('desktop-v0.0.2');
    expect(JSON.parse(await fs.readText(`${ROOT}/package.json`)).version).toBe('0.0.2');
    expect(res.manifest.platforms['linux-x86_64']).toEqual({
      signature: 'ODDSIG',
      url: 'https://github.com/aviynw/oddsmith/releases/download/desktop-v0.0.2/Oddsmith_0.0.2_amd64.AppImage',
    });
    expect(res.published?.action).toBe('created');
  });
});
