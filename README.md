# @papercusp/tauri-release-kit

Provider-agnostic **Tauri desktop build + release** orchestration, shared by
papercusp and oddsmith. The kit owns the release *dance*; each app injects its
*sidecar build* and supplies a config. Mirrors `@papercusp/deployment-driver`'s
shape: a pure core + a `configure*()`/driver seam + everything-injected ports.

Design + rationale: `/internal/docs/build-system/tauri-release-kit-proposal`.
Plan: `tauri-release-kit-shared-build-2026-06-25`.

## The split that makes this work

- **Generic (this lib):** version bump, channel→tag resolution, `tauri build`
  target matrix, artifact classification, `latest.json` updater-manifest
  generation, `gh release` upload, Mac/Windows VM (SSH frame) orchestration.
- **Injected per app (the seam):** `buildSidecar(ctx)` — papercusp's ~1,070-line
  bundler vs oddsmith's ~42-line esbuild — plus app id/name/repo/targets/signing
  key/VM creds via `TauriReleaseConfig`.

```ts
import { defaultTagFor, buildLatestManifest, type TauriReleaseConfig } from '@papercusp/tauri-release-kit';

const config: TauriReleaseConfig = {
  appName: 'Papercusp',
  appId: 'com.papercusp.desktop',
  root: '/abs/path/to/papercusp-desktop',
  repo: { owner: 'Papercusp', name: 'papercusp-desktop' },
  version: '0.0.2',
  channel: 'stable',
  versionFiles: [
    { path: 'package.json', kind: 'json' },
    { path: 'src-tauri/tauri.conf.json', kind: 'json' },
    { path: 'src-tauri/Cargo.toml', kind: 'cargo-toml' },
  ],
  targets: ['linux-x86_64'],
  signing: { keyPath: '~/.papercusp/signing/papercusp.key', passwordEnv: 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' },
  buildSidecar: async ({ root, ports }) => { await ports.exec.run('bash', [`${root}/bin/build-desktop-sidecar.sh`]); },
  latestJsonUrl: ({ tag, name }) => `https://github.com/Papercusp/papercusp-desktop/releases/download/${tag}/${name}`,
};
```

## Status

Pure core landed + tested (version bump, tag/channel, artifact classification,
latest.json). Side-effecting layers — the node Exec/Fs ports, the per-target
build drivers (Linux-local + Mac/Windows SSH frame), the `gh` release driver,
the `runRelease()` orchestrator, and the `bin/release` CLI — land next per the
plan (P-006/P-007). Until parity is proven against `bin/release-local.sh`, the
existing release scripts remain the source of truth and are left untouched.

## Modules

| Module | What | Side effects |
|---|---|---|
| `types.ts` | `TauriReleaseConfig`, ports, drivers, manifest | none |
| `tag.ts` | version/channel validation, `desktop-vX.Y.Z[-ch]` tags | none |
| `version.ts` | JSON + Cargo.toml version-bump transforms | none |
| `artifacts.ts` | bundle-path → `PlatformKey` classifier, sig path | none |
| `latest-json.ts` | `latest.json` updater manifest builder | none |

Zero runtime deps — borrowable standalone.
