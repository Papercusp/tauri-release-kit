import { describe, it, expect } from 'vitest';
import { makeVmBuildDriver, type VmBuildRecipe } from './vm.js';
import type { ExecPort, ExecResult, ReleasePorts, TauriReleaseConfig, VmConfig } from '../types.js';

const vm: VmConfig = {
  host: '127.0.0.1',
  port: 2223,
  user: 'user',
  identityFile: '/k',
  buildDir: 'papercup-build-release',
};

function ports(calls: string[][], stdoutFor: (remote: string) => { code: number; stdout: string }): ReleasePorts {
  const exec: ExecPort = {
    async run(cmd, args): Promise<ExecResult> {
      calls.push([cmd, ...args]);
      if (cmd === 'ssh') {
        const remote = args[args.length - 1];
        const r = stdoutFor(remote);
        return { code: r.code, stdout: r.stdout, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { exec, fs: {} as never, log: { info: () => {}, warn: () => {} }, env: () => undefined, now: () => 'T' };
}

function cfg(): TauriReleaseConfig {
  return {
    appName: 'Papercusp',
    appId: 'com.papercusp.desktop',
    root: '/repo/papercusp-desktop',
    repo: { owner: 'Papercusp', name: 'papercusp-desktop' },
    version: '0.0.2',
    channel: 'stable',
    versionFiles: [],
    targets: ['windows-x86_64'],
    signing: { keyPath: '/k' },
    buildSidecar: async () => {},
    latestJsonUrl: ({ tag, name }) => `https://x/${tag}/${name}`,
    vm: { 'windows-x86_64': vm, 'macos-universal': { ...vm, port: 2222 } },
  };
}

describe('makeVmBuildDriver — pack-ship-build-collect (Windows shape)', () => {
  it('packs, ships, extracts, builds, asserts success despite keyless exit 1, collects', async () => {
    const calls: string[][] = [];
    const recipe: VmBuildRecipe = {
      pack: {
        localTreeParent: '/repo',
        treeName: 'papercusp-desktop',
        excludes: ['.git', 'papercusp-desktop/node_modules'],
        localTarball: '/tmp/x.tar.gz',
        remoteTarball: 'C:/Users/user/x.tar.gz',
        extractCommand: 'EXTRACT',
      },
      remoteBuildCommand: 'BUILD',
      // Windows keyless build exits 1 but writes the bundle — assert on the log.
      assertSuccess: (log) =>
        log.includes('Finished') &&
        (log.includes('EXIT=0') || log.includes('no private key')),
      listCommand: 'LIST',
      remoteBundlePath: (n) => `C:/out/${n}`,
      collectDir: '/repo/papercusp-desktop/src-tauri/target/windows-vm/bundle/nsis',
    };
    const driver = makeVmBuildDriver('windows-x86_64', () => recipe);

    const p = ports(calls, (remote) => {
      if (remote === 'echo VM-OK') return { code: 0, stdout: 'VM-OK' };
      if (remote === 'BUILD') return { code: 1, stdout: 'Finished 1 bundle at: x\nA public key has been found, but no private key' };
      if (remote === 'LIST') return { code: 0, stdout: 'Papercusp_0.0.2_x64-setup.exe\r\n' };
      return { code: 0, stdout: '' };
    });

    const artifacts = await driver.build(cfg(), p);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].platformKey).toBe('windows-x86_64');
    expect(artifacts[0].path).toBe(
      '/repo/papercusp-desktop/src-tauri/target/windows-vm/bundle/nsis/Papercusp_0.0.2_x64-setup.exe',
    );

    // order: reachable(ssh echo) → tar → scp up → ssh EXTRACT → ssh BUILD → ssh LIST → scp down
    const seq = calls.map((c) => `${c[0]}:${c[0] === 'ssh' ? c[c.length - 1] : c[0] === 'tar' ? 'tar' : 'scp'}`);
    expect(seq).toEqual([
      'ssh:echo VM-OK',
      'tar:tar',
      'scp:scp',
      'ssh:EXTRACT',
      'ssh:BUILD',
      'ssh:LIST',
      'scp:scp',
    ]);
  });

  it('throws when the build log fails the success assertion', async () => {
    const recipe: VmBuildRecipe = {
      remoteBuildCommand: 'BUILD',
      assertSuccess: (log) => log.includes('Finished'),
      listCommand: 'LIST',
      remoteBundlePath: (n) => `/o/${n}`,
      collectDir: '/c',
    };
    const driver = makeVmBuildDriver('windows-x86_64', () => recipe);
    const p = ports([], (r) => (r === 'echo VM-OK' ? { code: 0, stdout: '' } : { code: 1, stdout: 'compile error' }));
    await expect(driver.build(cfg(), p)).rejects.toThrow(/VM build for windows-x86_64 failed/);
  });
});

describe('makeVmBuildDriver — build-in-place (Mac shape)', () => {
  it('skips pack/upload/extract; runs remote build then collects the dmg', async () => {
    const calls: string[][] = [];
    const recipe: VmBuildRecipe = {
      remoteBuildCommand: 'MACBUILD',
      listCommand: 'LSDMG',
      remoteBundlePath: (n) => `~/build/dmg/${n}`,
      collectDir: '/repo/papercusp-desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg',
    };
    const driver = makeVmBuildDriver('macos-universal', () => recipe);
    const p = ports(calls, (remote) => {
      if (remote === 'echo VM-OK') return { code: 0, stdout: 'VM-OK' };
      if (remote === 'MACBUILD') return { code: 0, stdout: 'Finished' };
      if (remote === 'LSDMG') return { code: 0, stdout: 'Papercusp_0.0.2_universal.dmg' };
      return { code: 0, stdout: '' };
    });

    const artifacts = await driver.build(cfg(), p);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].platformKey).toBe('darwin-universal');

    const kinds = calls.map((c) => c[0]);
    expect(kinds).not.toContain('tar'); // no pack
    expect(calls.filter((c) => c[0] === 'scp')).toHaveLength(1); // only the download
  });

  it('throws a clear error when no VM config exists for the target', async () => {
    const driver = makeVmBuildDriver('macos-universal', () => ({
      remoteBuildCommand: 'X',
      listCommand: 'L',
      remoteBundlePath: (n) => n,
      collectDir: '/c',
    }));
    const noVm = { ...cfg(), vm: {} };
    const p = ports([], () => ({ code: 0, stdout: '' }));
    await expect(driver.build(noVm, p)).rejects.toThrow(/no VM config/);
  });
});
