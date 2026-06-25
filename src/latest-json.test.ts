import { describe, it, expect } from 'vitest';
import { buildLatestManifest } from './latest-json.js';

const urlFor = ({ tag, name }: { tag: string; name: string }) =>
  `https://github.com/Papercusp/papercusp-desktop/releases/download/${tag}/${name}`;

describe('buildLatestManifest', () => {
  it('maps each signed artifact to a platform entry with url + signature', () => {
    const m = buildLatestManifest({
      version: '0.0.2',
      channel: 'stable',
      tag: 'desktop-v0.0.2',
      pubDate: '2026-06-25T00:00:00.000Z',
      appName: 'Papercusp',
      artifacts: [
        { name: 'App_0.0.2_amd64.AppImage', platformKey: 'linux-x86_64', signature: 'SIG_LINUX' },
        { name: 'App_0.0.2_x64.msi', platformKey: 'windows-x86_64', signature: 'SIG_WIN' },
      ],
      urlFor,
    });
    expect(m.version).toBe('0.0.2');
    expect(m.channel).toBe('stable');
    expect(m.pub_date).toBe('2026-06-25T00:00:00.000Z');
    expect(m.platforms['linux-x86_64']).toEqual({
      signature: 'SIG_LINUX',
      url: 'https://github.com/Papercusp/papercusp-desktop/releases/download/desktop-v0.0.2/App_0.0.2_amd64.AppImage',
    });
    expect(m.platforms['windows-x86_64'].signature).toBe('SIG_WIN');
    expect(m.notes).toContain('Papercusp 0.0.2 (stable)');
  });

  it('produces an empty platforms map when there are no updater artifacts', () => {
    const m = buildLatestManifest({
      version: '1.0.0',
      channel: 'alpha',
      tag: 'desktop-v1.0.0-alpha',
      pubDate: '2026-06-25T00:00:00.000Z',
      artifacts: [],
      urlFor,
    });
    expect(m.platforms).toEqual({});
  });
});
