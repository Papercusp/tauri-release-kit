/** Build the auto-updater `latest.json` manifest. Pure. */
import type { Channel, LatestManifest, PlatformEntry, PlatformKey } from './types.js';

/** An artifact whose `.sig` content has already been read in (keeps this pure). */
export interface ManifestArtifact {
  name: string;
  platformKey: PlatformKey;
  signature: string;
}

/**
 * Produce the canonical latest.json. The operator's /api/updates/manifest
 * converts this to Tauri's updater wire format, so this is the source of truth.
 * `pubDate` is injected (caller passes new Date().toISOString()) so the result
 * is deterministic + testable.
 */
export function buildLatestManifest(opts: {
  version: string;
  channel: Channel;
  tag: string;
  artifacts: ManifestArtifact[];
  urlFor: (a: { tag: string; name: string }) => string;
  pubDate: string;
  appName?: string;
  notes?: string;
}): LatestManifest {
  const platforms: Record<string, PlatformEntry> = {};
  for (const a of opts.artifacts) {
    platforms[a.platformKey] = {
      signature: a.signature,
      url: opts.urlFor({ tag: opts.tag, name: a.name }),
    };
  }
  const label = opts.appName ?? 'Desktop';
  return {
    version: opts.version,
    channel: opts.channel,
    notes:
      opts.notes ??
      `${label} ${opts.version} (${opts.channel}). See release notes.`,
    pub_date: opts.pubDate,
    platforms,
  };
}
