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
  dirs = new Set<string>();
  async mkdir(dir: string): Promise<void> {
    // EI-7474: FsPort.mkdir — in-memory fake just records the dir was made.
    this.dirs.add(dir);
  }
}

/**
 * A fake git remote, so the push-landed guard is exercised rather than stubbed
 * to always-true. `detached` models the ephemeral pinned clone a real cut runs
 * in; `swallowPush` models a push that reports success without the refs
 * actually arriving (the EI-21109338107156684 lost-version-bump shape).
 */
interface GitState {
  head: string;
  detached: boolean;
  swallowPush: boolean;
  remote: Map<string, string>;
}

function makeGit(overrides: Partial<GitState> = {}): GitState {
  return {
    head: 'b4d22b0b'.padEnd(40, '0'),
    detached: false,
    swallowPush: false,
    remote: new Map(),
    ...overrides,
  };
}

function makePorts(fs: MemFs, calls: string[][], git: GitState = makeGit()): ReleasePorts {
  const exec: ExecPort = {
    async run(cmd, args): Promise<ExecResult> {
      calls.push([cmd, ...args]);
      // gh release view → "not found" so the create path is exercised
      if (cmd === 'gh' && args[1] === 'view') return { code: 1, stdout: '', stderr: '' };
      if (cmd === 'git') {
        // argv shape is always ['-C', <root>, <sub>, ...rest]
        const sub = args[2];
        if (sub === 'symbolic-ref') {
          return git.detached
            ? { code: 1, stdout: '', stderr: 'fatal: ref HEAD is not a symbolic ref' }
            : { code: 0, stdout: 'main\n', stderr: '' };
        }
        if (sub === 'rev-parse') return { code: 0, stdout: `${git.head}\n`, stderr: '' };
        if (sub === 'push') {
          if (!git.swallowPush) {
            for (const spec of args.slice(4)) {
              const dest = spec.startsWith('HEAD:') ? spec.slice('HEAD:'.length) : spec;
              git.remote.set(dest, git.head);
            }
          }
          return { code: 0, stdout: '', stderr: '' };
        }
        if (sub === 'ls-remote') {
          const lines = args
            .slice(4)
            .filter((ref) => git.remote.has(ref))
            .map((ref) => `${git.remote.get(ref)}\t${ref}`);
          return { code: 0, stdout: lines.length ? lines.join('\n') + '\n' : '', stderr: '' };
        }
      }
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
    expect(
      flat.some((c) =>
        c.includes(
          'git -C ' + ROOT + ' push origin HEAD:refs/heads/main refs/tags/desktop-v0.0.2',
        ),
      ),
    ).toBe(true);
    expect(res.published?.action).toBe('created');
    expect(flat.some((c) => c.includes('release create') && c.includes('--prerelease'))).toBe(false);
  });

  it('EI-21109338107156684: a DETACHED HEAD still pushes the bump to a named branch', async () => {
    // The real cut runs in an ephemeral clone pinned to a sha, so HEAD is
    // detached. `git push origin HEAD` derives no destination there, which is
    // how the 0.0.18 version bump reached no branch in the canonical repo.
    const fs = seedFs();
    const calls: string[][] = [];
    const git = makeGit({ detached: true });
    const ports = makePorts(fs, calls, git);

    await runRelease(makeConfig({ releaseBranch: 'main' }), ports);

    const flat = calls.map((c) => c.join(' '));
    expect(flat.some((c) => c.includes(' push origin HEAD:refs/heads/main '))).toBe(true);
    // and it is not the ambiguous bare-HEAD form that loses the commit
    expect(flat.some((c) => /push origin HEAD /.test(c))).toBe(false);
    expect(git.remote.get('refs/tags/desktop-v0.0.2')).toBe(git.head);
    expect(git.remote.has('refs/heads/main')).toBe(true);
  });

  it('EI-21109338107156684: fails the cut when the tag never reaches origin', async () => {
    // Falsifiability control for the push-landed guard: a push that reports
    // success while the refs never arrive must fail loudly here, not surface a
    // release later as "every source build still reports the old version".
    const fs = seedFs();
    const calls: string[][] = [];
    const ports = makePorts(fs, calls, makeGit({ swallowPush: true }));

    await expect(runRelease(makeConfig(), ports)).rejects.toThrow(
      /refs\/tags\/desktop-v0\.0\.2 is absent from origin/,
    );
  });

  it('EI-21109338107156684: fails the cut when origin has the tag at a different commit', async () => {
    const fs = seedFs();
    const calls: string[][] = [];
    const git = makeGit();
    // a stale tag already on origin, pointing somewhere else
    git.remote.set('refs/tags/desktop-v0.0.2', 'c'.repeat(40));
    git.remote.set('refs/heads/main', 'c'.repeat(40));
    const ports = makePorts(fs, calls, { ...git, swallowPush: true, remote: git.remote });

    await expect(runRelease(makeConfig(), ports)).rejects.toThrow(
      /expected the release commit/,
    );
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
