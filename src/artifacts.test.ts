import { describe, it, expect } from 'vitest';
import {
  defaultSigPath,
  defaultClassifyArtifact,
  basename,
  toArtifact,
} from './artifacts.js';

describe('defaultSigPath', () => {
  it('appends .sig (matches release-local.sh for AppImage + msi)', () => {
    expect(defaultSigPath('/b/Foo.AppImage')).toBe('/b/Foo.AppImage.sig');
    expect(defaultSigPath('/b/Foo-amd64.msi')).toBe('/b/Foo-amd64.msi.sig');
  });
});

describe('defaultClassifyArtifact', () => {
  it('classifies the well-known Tauri bundle names', () => {
    expect(defaultClassifyArtifact('/b/appimage/Papercusp_0.0.2_amd64.AppImage')).toBe('linux-x86_64');
    expect(defaultClassifyArtifact('/t/aarch64-unknown-linux-gnu/.../App_arm64.AppImage')).toBe('linux-aarch64');
    expect(defaultClassifyArtifact('/b/msi/Papercusp_0.0.2_x64_en-US-amd64.msi')).toBe('windows-x86_64');
    expect(defaultClassifyArtifact('/b/dmg/Papercusp_0.0.2_universal.dmg')).toBe('darwin-universal');
  });
  it('returns null for non-updater artifacts (deb/rpm/nsis-without-pattern)', () => {
    expect(defaultClassifyArtifact('/b/deb/papercusp_0.0.2_amd64.deb')).toBeNull();
    expect(defaultClassifyArtifact('/b/rpm/papercusp-0.0.2.x86_64.rpm')).toBeNull();
  });
});

describe('basename', () => {
  it('handles posix and windows separators', () => {
    expect(basename('/a/b/c.AppImage')).toBe('c.AppImage');
    expect(basename('C\\\\Users\\\\x\\\\app.msi')).toBe('app.msi');
    expect(basename('no-dir.deb')).toBe('no-dir.deb');
  });
});

describe('toArtifact', () => {
  it('builds a record with name, platformKey, sigPath', () => {
    const a = toArtifact('/b/appimage/App_0.0.2_amd64.AppImage');
    expect(a).toEqual({
      path: '/b/appimage/App_0.0.2_amd64.AppImage',
      name: 'App_0.0.2_amd64.AppImage',
      platformKey: 'linux-x86_64',
      sigPath: '/b/appimage/App_0.0.2_amd64.AppImage.sig',
    });
  });
  it('leaves platformKey undefined for a non-updater artifact', () => {
    expect(toArtifact('/b/deb/app.deb').platformKey).toBeUndefined();
  });
});
