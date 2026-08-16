/**
 * Parity spec: assert the kit reproduces bin/release-local.sh's behavior for
 * the papercusp case, byte/shape-for-shape. This is the executable gate behind
 * D-006 (parity gates retiring the old script + oddsmith adoption). Each block
 * cites the release-local.sh behavior it pins.
 */
import { describe, it, expect } from 'vitest';
import { defaultTagFor, isPrerelease } from './tag.js';
import { bumpJson, bumpCargoToml } from './version.js';
import { defaultClassifyArtifact } from './artifacts.js';
import { buildLatestManifest } from './latest-json.js';
import { ghCreateArgs, ghViewArgs } from './gh.js';

const repo = { owner: 'Papercusp', name: 'papercusp-desktop' };
const url = ({ tag, name }: { tag: string; name: string }) =>
  `https://github.com/Papercusp/papercusp-desktop/releases/download/${tag}/${name}`;

describe('parity: tag scheme (release-local.sh L62-66)', () => {
  it('alpha/beta/stable map identically', () => {
    expect(defaultTagFor('0.0.4', 'alpha')).toBe('desktop-v0.0.4-alpha');
    expect(defaultTagFor('0.0.3', 'beta')).toBe('desktop-v0.0.3-beta');
    expect(defaultTagFor('0.0.2', 'stable')).toBe('desktop-v0.0.2');
  });
});

describe('parity: version bump format (release-local.sh L100-117)', () => {
  it('JSON = json.dumps(indent=2) + "\\n"', () => {
    // package.json
    const pkg = JSON.stringify({ name: '@papercusp/desktop', version: '0.0.1' }, null, 2) + '\n';
    expect(bumpJson(pkg, '0.0.2')).toBe(
      '{\n  "name": "@papercusp/desktop",\n  "version": "0.0.2"\n}\n',
    );
  });
  it('Cargo.toml rewrites only the first version line', () => {
    const cargo = '[package]\nname = "papercusp"\nversion = "0.0.1"\n\n[dependencies]\ntauri = { version = "2" }\n';
    const out = bumpCargoToml(cargo, '0.0.2');
    expect(out).toContain('version = "0.0.2"');
    expect(out).toContain('tauri = { version = "2" }'); // dep untouched
  });
});

describe('parity: latest.json platform selection (release-local.sh L170, L184-194)', () => {
  it('AppImage→linux-x86_64, -amd64.msi→windows-x86_64, aarch64 AppImage→linux-aarch64', () => {
    expect(defaultClassifyArtifact('bundle/appimage/Papercusp_0.0.2_amd64.AppImage')).toBe('linux-x86_64');
    expect(defaultClassifyArtifact('bundle/msi/Papercusp_0.0.2_x64_en-US-amd64.msi')).toBe('windows-x86_64');
    expect(
      defaultClassifyArtifact('target/aarch64-unknown-linux-gnu/release/bundle/appimage/Papercusp_0.0.2_arm64.AppImage'),
    ).toBe('linux-aarch64');
  });

  it('manifest entry uses the exact GH download URL + sig content', () => {
    const m = buildLatestManifest({
      version: '0.0.2',
      channel: 'stable',
      tag: 'desktop-v0.0.2',
      pubDate: '2026-06-25T00:00:00.000Z',
      appName: 'Papercusp',
      artifacts: [
        { name: 'Papercusp_0.0.2_amd64.AppImage', platformKey: 'linux-x86_64', signature: 'SIG' },
      ],
      urlFor: url,
    });
    expect(m.platforms['linux-x86_64']).toEqual({
      signature: 'SIG',
      url: 'https://github.com/Papercusp/papercusp-desktop/releases/download/desktop-v0.0.2/Papercusp_0.0.2_amd64.AppImage',
    });
  });
});

describe('parity: gh release (release-local.sh L229-246)', () => {
  it('view targets the right repo', () => {
    expect(ghViewArgs('desktop-v0.0.2', repo)).toContain('Papercusp/papercusp-desktop');
  });
  it('create adds --prerelease for non-stable only', () => {
    expect(isPrerelease('alpha')).toBe(true);
    expect(isPrerelease('stable')).toBe(false);
    const stable = ghCreateArgs({ tag: 'desktop-v0.0.2', repo, title: 'Papercusp 0.0.2 (stable)', channel: 'stable', assets: [] });
    expect(stable).not.toContain('--prerelease');
    const beta = ghCreateArgs({ tag: 'desktop-v0.0.3-beta', repo, title: 'x', channel: 'beta', assets: [] });
    expect(beta).toContain('--prerelease');
  });
});
