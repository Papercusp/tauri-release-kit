import { describe, it, expect } from 'vitest';
import { resolveTargetDir, bundleRootFor, collectArtifacts, isArtifactFile, signingEnv } from './tauri-build.js';
import type { ExecPort, FsPort, ReleasePorts, TauriReleaseConfig } from './types.js';

function cfg(extra: Partial<TauriReleaseConfig> = {}): TauriReleaseConfig {
  return {
    appName: 'X',
    appId: 'x',
    root: '/app',
    repo: { owner: 'o', name: 'n' },
    version: '0.0.1',
    channel: 'stable',
    versionFiles: [],
    targets: [],
    signing: { keyPath: '/k' },
    buildSidecar: async () => {},
    latestJsonUrl: () => '',
    ...extra,
  };
}

function ports(exec: ExecPort): ReleasePorts {
  return { exec, fs: {} as never, log: { info: () => {}, warn: () => {} }, env: () => undefined, now: () => 'T' };
}

describe('resolveTargetDir (the ~/.cargo-target redirect bug)', () => {
  it('uses cargo metadata target_directory (honors CARGO_TARGET_DIR / .cargo/config)', async () => {
    const exec: ExecPort = {
      async run(cmd, args) {
        expect(cmd).toBe('cargo');
        expect(args).toContain('metadata');
        return { code: 0, stdout: JSON.stringify({ target_directory: '/home/me/.cargo-target' }), stderr: '' };
      },
    };
    const td = await resolveTargetDir(ports(exec), cfg());
    expect(td).toBe('/home/me/.cargo-target');
    // bundle roots compose off the resolved dir, not <root>/src-tauri/target
    expect(bundleRootFor(td)).toBe('/home/me/.cargo-target/release/bundle');
    expect(bundleRootFor(td, 'aarch64-unknown-linux-gnu')).toBe(
      '/home/me/.cargo-target/aarch64-unknown-linux-gnu/release/bundle',
    );
  });

  it('explicit cargoTargetDir override wins without shelling cargo', async () => {
    let called = false;
    const exec: ExecPort = {
      async run() {
        called = true;
        return { code: 0, stdout: '', stderr: '' };
      },
    };
    const td = await resolveTargetDir(ports(exec), cfg({ cargoTargetDir: '/forced' }));
    expect(td).toBe('/forced');
    expect(called).toBe(false);
  });

  it('falls back to <root>/src-tauri/target when cargo metadata fails', async () => {
    const exec: ExecPort = {
      async run() {
        return { code: 1, stdout: 'not json', stderr: 'boom' };
      },
    };
    expect(await resolveTargetDir(ports(exec), cfg())).toBe('/app/src-tauri/target');
  });
});

describe('signingEnv (EI-12203: must emit the Tauri v2 var, not the ignored _PATH)', () => {
  it('sets TAURI_SIGNING_PRIVATE_KEY (v2 accepts the key path) — NOT the ignored _PATH', () => {
    const env = signingEnv(cfg({ signing: { keyPath: '/keys/app.key' } }), ports({ async run() { return { code: 0, stdout: '', stderr: '' }; } }));
    // The v2 CLI reads TAURI_SIGNING_PRIVATE_KEY; the old _PATH name is a no-op
    // that left createUpdaterArtifacts builds unsigned.
    expect(env.TAURI_SIGNING_PRIVATE_KEY).toBe('/keys/app.key');
    expect('TAURI_SIGNING_PRIVATE_KEY_PATH' in env).toBe(false);
  });

  it('reads the password from the named env var (empty string when unset)', () => {
    const withPw = signingEnv(
      cfg({ signing: { keyPath: '/k', passwordEnv: 'MY_PW' } }),
      { exec: { async run() { return { code: 0, stdout: '', stderr: '' }; } }, fs: {} as never, log: { info: () => {}, warn: () => {} }, env: (n) => (n === 'MY_PW' ? 'secret' : undefined), now: () => 'T' },
    );
    expect(withPw.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe('secret');
    // No passwordEnv configured ⇒ empty password (not undefined).
    const noPw = signingEnv(cfg({ signing: { keyPath: '/k' } }), ports({ async run() { return { code: 0, stdout: '', stderr: '' }; } }));
    expect(noPw.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe('');
  });
});

describe('isArtifactFile', () => {
  it('accepts installer files; rejects staging dirs + sigs', () => {
    expect(isArtifactFile('Papercusp_0.0.2_amd64.deb')).toBe(true);
    expect(isArtifactFile('Papercusp_0.0.2_amd64.AppImage')).toBe(true);
    expect(isArtifactFile('App_x64-setup.exe')).toBe(true);
    expect(isArtifactFile('Papercusp.AppDir')).toBe(false); // dir
    expect(isArtifactFile('Papercusp_0.0.2_amd64')).toBe(false); // deb staging dir
    expect(isArtifactFile('Foo.AppImage.sig')).toBe(false); // sig rides via sigPath
  });
});

describe('collectArtifacts filtering (the dir + stale-version bug from the live build)', () => {
  const fsWith = (entries: Record<string, string[]>): FsPort => ({
    readText: async () => '',
    writeText: async () => {},
    exists: async () => true,
    readDir: async (dir) => entries[dir] ?? [],
    // EI-7474: FsPort now requires mkdir; collectArtifacts never calls it
    // (read-only), but the literal must still satisfy the interface.
    mkdir: async () => {},
  });
  const portsWith = (f: FsPort): ReleasePorts => ({
    exec: { async run() { return { code: 0, stdout: '', stderr: '' }; } },
    fs: f,
    log: { info: () => {}, warn: () => {} },
    env: () => undefined,
    now: () => 'T',
  });

  it('drops staging dirs + stale older-version files, keeps the current version', async () => {
    const f = fsWith({
      '/b/appimage': ['Papercusp_0.0.2_amd64.AppImage', 'Papercusp.AppDir', 'Papercusp_0.0.1_amd64.AppImage'],
      '/b/deb': ['Papercusp_0.0.2_amd64.deb', 'Papercusp_0.0.2_amd64'],
      '/b/rpm': ['Papercusp-0.0.2-1.x86_64.rpm', 'Papercusp-0.0.2-1.x86_64'],
    });
    const arts = await collectArtifacts(portsWith(f), '/b', ['appimage', 'deb', 'rpm'], undefined, { version: '0.0.2' });
    expect(arts.map((a) => a.name).sort()).toEqual([
      'Papercusp-0.0.2-1.x86_64.rpm',
      'Papercusp_0.0.2_amd64.AppImage',
      'Papercusp_0.0.2_amd64.deb',
    ]);
    expect(arts.find((a) => a.name.endsWith('.AppImage'))!.platformKey).toBe('linux-x86_64');
  });
});
