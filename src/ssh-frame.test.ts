import { describe, it, expect } from 'vitest';
import { sshArgs, scpUploadArgs, scpDownloadArgs, SshFrame } from './ssh-frame.js';
import type { ExecPort, ExecResult, VmConfig } from './types.js';

const vm: VmConfig = {
  host: '127.0.0.1',
  port: 2223,
  user: 'user',
  identityFile: '/home/me/.ssh/papercup-vm-win',
  buildDir: 'papercup-build-release',
};

describe('ssh/scp arg construction (parity with build-windows-on-vm.sh)', () => {
  it('ssh uses -p, IdentitiesOnly, ConnectTimeout, ServerAliveInterval', () => {
    expect(sshArgs(vm, 'cmd /c echo VM-OK')).toEqual([
      '-i', '/home/me/.ssh/papercup-vm-win',
      '-o', 'IdentitiesOnly=yes',
      '-p', '2223',
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=30',
      'user@127.0.0.1',
      'cmd /c echo VM-OK',
    ]);
  });

  it('scp upload uses -P (uppercase) and user@host:remote', () => {
    expect(scpUploadArgs(vm, '/tmp/x.tar.gz', 'C:/Users/user/x.tar.gz')).toEqual([
      '-i', '/home/me/.ssh/papercup-vm-win',
      '-o', 'IdentitiesOnly=yes',
      '-P', '2223',
      '-o', 'ConnectTimeout=10',
      '/tmp/x.tar.gz',
      'user@127.0.0.1:C:/Users/user/x.tar.gz',
    ]);
  });

  it('scp download flips source/dest', () => {
    const a = scpDownloadArgs(vm, 'C:/out/app-setup.exe', '/local/app-setup.exe');
    expect(a[a.length - 2]).toBe('user@127.0.0.1:C:/out/app-setup.exe');
    expect(a[a.length - 1]).toBe('/local/app-setup.exe');
  });
});

function recordingExec(codeFor: (cmd: string, args: string[]) => number, calls: string[][]): ExecPort {
  return {
    async run(cmd, args): Promise<ExecResult> {
      calls.push([cmd, ...args]);
      return { code: codeFor(cmd, args), stdout: 'VM-OK', stderr: '' };
    },
  };
}

describe('SshFrame', () => {
  it('run() shells ssh with the remote command', async () => {
    const calls: string[][] = [];
    const frame = new SshFrame(vm, recordingExec(() => 0, calls));
    await frame.run('powershell -File build.ps1');
    expect(calls[0][0]).toBe('ssh');
    expect(calls[0]).toContain('powershell -File build.ps1');
  });

  it('upload/download throw on non-zero exit', async () => {
    const frame = new SshFrame(vm, recordingExec(() => 1, []));
    await expect(frame.upload('/a', '/b')).rejects.toThrow(/scp upload/);
    await expect(frame.download('/a', '/b')).rejects.toThrow(/scp download/);
  });

  it('reachable() is true on exit 0', async () => {
    const frame = new SshFrame(vm, recordingExec(() => 0, []));
    expect(await frame.reachable()).toBe(true);
  });
});
