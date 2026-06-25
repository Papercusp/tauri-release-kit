/**
 * runRelease — the orchestrator. Wires the pure core + drivers + gh over the
 * injected ports. This is the generic equivalent of bin/release-local.sh's body:
 *   validate → bump versions → buildSidecar → build targets → collect sigs →
 *   write latest.json → git commit/tag/push → gh release.
 * Every step is a port call, so the whole thing is testable with in-memory fakes.
 */
import type {
  Artifact,
  LatestManifest,
  ReleasePorts,
  TauriReleaseConfig,
} from './types.js';
import { assertValidChannel, assertValidVersion, defaultTagFor } from './tag.js';
import { applyVersionBump } from './version.js';
import { resolveTargetDriver } from './registry.js';
import { buildLatestManifest, type ManifestArtifact } from './latest-json.js';
import { publishRelease } from './gh.js';
import { joinPath } from './path.js';

export interface RunReleaseOptions {
  /** Skip git commit/tag/push (e.g. a parity dry-run). Default false. */
  skipGit?: boolean;
  /** Skip the gh release publish. Default false. */
  skipPublish?: boolean;
  /** Where to write latest.json (default <root>/latest.json). */
  latestJsonPath?: string;
  /** Release-notes file path passed to `gh release create`. */
  notesFile?: string;
}

export interface RunReleaseResult {
  tag: string;
  artifacts: Artifact[];
  manifest: LatestManifest;
  latestJsonPath: string;
  published?: { action: 'created' | 'uploaded' };
}

export async function runRelease(
  cfg: TauriReleaseConfig,
  ports: ReleasePorts,
  opts: RunReleaseOptions = {},
): Promise<RunReleaseResult> {
  assertValidVersion(cfg.version);
  assertValidChannel(cfg.channel);
  const tagFor = cfg.tagFor ?? defaultTagFor;
  const tag = tagFor(cfg.version, cfg.channel);
  ports.log.info(`release ${cfg.appName} ${cfg.version} (${cfg.channel}) — tag ${tag}`);

  // 1. version bump
  for (const vf of cfg.versionFiles) {
    const p = joinPath(cfg.root, vf.path);
    if (!(await ports.fs.exists(p))) {
      ports.log.warn(`version file missing, skipped: ${vf.path}`);
      continue;
    }
    const text = await ports.fs.readText(p);
    await ports.fs.writeText(p, applyVersionBump(vf, text, cfg.version));
    ports.log.info(`  bumped ${vf.path} → ${cfg.version}`);
  }

  // 2. sidecar (the injected per-app seam)
  await cfg.buildSidecar({
    root: cfg.root,
    version: cfg.version,
    channel: cfg.channel,
    ports,
  });

  // 3. build each target
  const artifacts: Artifact[] = [];
  for (const t of cfg.targets) {
    const driver = resolveTargetDriver(t);
    ports.log.info(`building target ${t}`);
    artifacts.push(...(await driver.build(cfg, ports)));
  }
  if (artifacts.length === 0) ports.log.warn('no artifacts produced');

  // 4. read signatures for updater targets
  const signed: ManifestArtifact[] = [];
  for (const a of artifacts) {
    if (!a.platformKey) continue;
    let signature = '';
    if (a.sigPath && (await ports.fs.exists(a.sigPath))) {
      signature = (await ports.fs.readText(a.sigPath)).trim();
    } else {
      ports.log.warn(`no signature for ${a.name} (${a.platformKey})`);
    }
    signed.push({ name: a.name, platformKey: a.platformKey, signature });
  }

  // 5. latest.json updater manifest
  const manifest = buildLatestManifest({
    version: cfg.version,
    channel: cfg.channel,
    tag,
    artifacts: signed,
    urlFor: cfg.latestJsonUrl,
    pubDate: ports.now(),
    appName: cfg.appName,
  });
  const latestJsonPath = opts.latestJsonPath ?? joinPath(cfg.root, 'latest.json');
  await ports.fs.writeText(latestJsonPath, JSON.stringify(manifest, null, 2) + '\n');

  // 6. git commit/tag/push (the desktop repo, not this monorepo)
  if (!opts.skipGit) {
    await gitCommitTagPush(ports, cfg, tag);
  }

  // 7. publish to GitHub releases
  const assets = [latestJsonPath];
  for (const a of artifacts) {
    assets.push(a.path);
    if (a.sigPath && (await ports.fs.exists(a.sigPath))) assets.push(a.sigPath);
  }
  let published: { action: 'created' | 'uploaded' } | undefined;
  if (!opts.skipPublish) {
    published = await publishRelease(ports, {
      tag,
      repo: cfg.repo,
      title: `${cfg.appName} ${cfg.version} (${cfg.channel})`,
      notesFile: opts.notesFile,
      channel: cfg.channel,
      assets,
    });
  }

  return { tag, artifacts, manifest, latestJsonPath, published };
}

async function gitCommitTagPush(
  ports: ReleasePorts,
  cfg: TauriReleaseConfig,
  tag: string,
): Promise<void> {
  const addPaths = new Set<string>(cfg.versionFiles.map((v) => v.path));
  // a Cargo.toml bump also dirties the sibling Cargo.lock
  for (const v of cfg.versionFiles) {
    if (v.kind === 'cargo-toml') {
      addPaths.add(v.path.replace(/Cargo\.toml$/, 'Cargo.lock'));
    }
  }
  await ports.exec.run('git', ['-C', cfg.root, 'add', ...addPaths]);
  const commit = await ports.exec.run('git', ['-C', cfg.root, 'commit', '-m', `release: ${tag}`]);
  if (commit.code !== 0) {
    ports.log.warn(`git commit: ${commit.stderr || commit.stdout || '(nothing to commit)'}`);
  }
  const tagged = await ports.exec.run('git', ['-C', cfg.root, 'tag', '-f', tag]);
  if (tagged.code !== 0) throw new Error(`git tag failed: ${tagged.stderr || tagged.stdout}`);
  const push = await ports.exec.run('git', ['-C', cfg.root, 'push', 'origin', 'HEAD', tag]);
  if (push.code !== 0) throw new Error(`git push failed: ${push.stderr || push.stdout}`);
}
