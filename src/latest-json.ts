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
  /**
   * Builds the download url for an artifact. MUST percent-encode the filename
   * segment: bundle names routinely contain spaces ("Papercusp GUI.app.tar.gz"),
   * and a url carrying a literal space is rejected by the client outright, so the
   * manifest validates and the signature verifies while the download still fails.
   * Encode ONLY the name — a base url may legitimately carry path segments whose
   * slashes must survive. Violations are rejected below rather than shipped.
   */
  urlFor: (a: { tag: string; name: string }) => string;
  pubDate: string;
  appName?: string;
  notes?: string;
}): LatestManifest {
  const platforms: Record<string, PlatformEntry> = {};
  for (const a of opts.artifacts) {
    const url = opts.urlFor({ tag: opts.tag, name: a.name });
    // Fail loud on an unfetchable url. The downstream failure is SILENT — an
    // updater cannot distinguish a failed check from "no update available", so a
    // malformed url surfaces to users as "up to date" forever rather than as an
    // error. `urlFor` is a caller seam, so this is the only place the kit can
    // catch it.
    if (/\s/.test(url)) {
      throw new Error(
        `latest.json: url for ${a.platformKey} contains whitespace (${JSON.stringify(url)}) — ` +
          `percent-encode the filename segment in urlFor(); a client rejects this url and the ` +
          `updater would silently report "up to date"`,
      );
    }
    platforms[a.platformKey] = { signature: a.signature, url };
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
