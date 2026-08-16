import { describe, it, expect } from 'vitest';
import {
  repoSlug,
  ghViewArgs,
  ghUploadArgs,
  ghCreateArgs,
  publishRelease,
} from './gh.js';
import type { ExecPort, ExecResult } from './types.js';

const repo = { owner: 'Papercusp', name: 'papercusp-desktop' };

describe('gh arg builders', () => {
  it('repoSlug', () => {
    expect(repoSlug(repo)).toBe('Papercusp/papercusp-desktop');
  });
  it('view args', () => {
    expect(ghViewArgs('desktop-v0.0.2', repo)).toEqual([
      'release', 'view', 'desktop-v0.0.2', '--repo', 'Papercusp/papercusp-desktop',
    ]);
  });
  it('upload args use --clobber', () => {
    expect(ghUploadArgs({ tag: 'desktop-v0.0.2', repo, assets: ['/a.AppImage', '/latest.json'] })).toEqual([
      'release', 'upload', 'desktop-v0.0.2', '/a.AppImage', '/latest.json',
      '--repo', 'Papercusp/papercusp-desktop', '--clobber',
    ]);
  });
  it('create args add --prerelease only for non-stable', () => {
    const stable = ghCreateArgs({ tag: 'desktop-v1', repo, title: 'T', channel: 'stable', assets: ['/a'] });
    expect(stable).not.toContain('--prerelease');
    const alpha = ghCreateArgs({ tag: 'desktop-v1-alpha', repo, title: 'T', channel: 'alpha', notesFile: '/n.md', assets: ['/a'] });
    expect(alpha).toContain('--prerelease');
    expect(alpha).toContain('--notes-file');
    expect(alpha).toContain('/n.md');
  });
});

// Fake Exec that scripts return codes by command shape.
function fakeExec(viewCode: number, calls: string[][]): ExecPort {
  return {
    async run(cmd, args): Promise<ExecResult> {
      calls.push([cmd, ...args]);
      if (args[1] === 'view') return { code: viewCode, stdout: '', stderr: '' };
      return { code: 0, stdout: 'ok', stderr: '' };
    },
  };
}

const log = { info: () => {}, warn: () => {} };

describe('publishRelease', () => {
  it('uploads with --clobber when the release already exists', async () => {
    const calls: string[][] = [];
    const r = await publishRelease({ exec: fakeExec(0, calls), log }, {
      tag: 'desktop-v0.0.2', repo, title: 'T', channel: 'stable', assets: ['/a.AppImage'],
    });
    expect(r.action).toBe('uploaded');
    expect(calls[1]).toContain('upload');
    expect(calls[1]).toContain('--clobber');
  });

  it('creates when the release does not exist', async () => {
    const calls: string[][] = [];
    const r = await publishRelease({ exec: fakeExec(1, calls), log }, {
      tag: 'desktop-v0.0.3-beta', repo, title: 'T', channel: 'beta', assets: ['/a.AppImage'],
    });
    expect(r.action).toBe('created');
    expect(calls[1]).toContain('create');
    expect(calls[1]).toContain('--prerelease');
  });

  it('throws if create fails', async () => {
    const exec: ExecPort = {
      async run(_cmd, args) {
        if (args[1] === 'view') return { code: 1, stdout: '', stderr: '' };
        return { code: 1, stdout: '', stderr: 'boom' };
      },
    };
    await expect(
      publishRelease({ exec, log }, { tag: 't', repo, title: 'T', channel: 'stable', assets: [] }),
    ).rejects.toThrow(/gh release create failed: boom/);
  });
});
