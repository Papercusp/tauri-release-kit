import { describe, it, expect } from 'vitest';
import { buildLatestManifest } from './latest-json.js';

const urlFor = ({ tag, name }: { tag: string; name: string }) =>
  `https://github.com/Papercusp/papercusp-desktop/releases/download/${tag}/${name}`;

describe('buildLatestManifest — unfetchable urls are refused (WI-4364)', () => {
  // Bundle names with SPACES ("Papercusp GUI.app.tar.gz") are the norm on macOS
  // and Windows. A url carrying a literal space is rejected by the client, but the
  // manifest still validates and the signature still verifies — and because an
  // updater reads a failed check as "no update", it presents as "up to date"
  // forever. Fail at build time instead.
  const rawUrlFor = ({ tag, name }: { tag: string; name: string }) =>
    `https://dl.example.com/secret/${tag}/${name}`;
  const encodedUrlFor = ({ tag, name }: { tag: string; name: string }) =>
    `https://dl.example.com/secret/${tag}/${encodeURIComponent(name)}`;

  const spacedArtifact = {
    name: 'Papercusp GUI.app.tar.gz',
    platformKey: 'darwin-aarch64' as const,
    signature: 'SIG_MAC',
  };
  const base = {
    version: '0.0.8',
    channel: 'stable' as const,
    tag: 'desktop-v0.0.8',
    pubDate: '2026-07-12T00:00:00.000Z',
    artifacts: [spacedArtifact],
  };

  it('throws when urlFor leaves a literal space in the url', () => {
    expect(() => buildLatestManifest({ ...base, urlFor: rawUrlFor })).toThrow(/whitespace/i);
  });

  it('accepts a percent-encoded filename and preserves the base path segments', () => {
    const m = buildLatestManifest({ ...base, urlFor: encodedUrlFor });
    expect(m.platforms['darwin-aarch64'].url).toBe(
      'https://dl.example.com/secret/desktop-v0.0.8/Papercusp%20GUI.app.tar.gz',
    );
    // the base's own slashes must survive — only the name is encoded
    expect(m.platforms['darwin-aarch64'].url).toContain('/secret/desktop-v0.0.8/');
  });
});

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
