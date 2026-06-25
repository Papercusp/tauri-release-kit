import { describe, it, expect } from 'vitest';
import { resolveTargetDir, bundleRootFor } from './tauri-build.js';
import type { ExecPort, ReleasePorts, TauriReleaseConfig } from './types.js';

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
