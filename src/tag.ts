/** Channel + version + tag resolution. Pure. */
import type { Channel } from './types.js';

export const CHANNELS: readonly Channel[] = ['alpha', 'beta', 'stable'];

/** semver-ish: X.Y.Z with optional -prerelease (matches bin/release-local.sh). */
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.-]+)?$/;

export function isValidVersion(version: string): boolean {
  return VERSION_RE.test(version);
}

export function assertValidVersion(version: string): void {
  if (!isValidVersion(version)) {
    throw new Error(
      `invalid version "${version}": must look like X.Y.Z or X.Y.Z-foo`,
    );
  }
}

export function isValidChannel(channel: string): channel is Channel {
  return (CHANNELS as readonly string[]).includes(channel);
}

export function assertValidChannel(channel: string): asserts channel is Channel {
  if (!isValidChannel(channel)) {
    throw new Error(`invalid channel "${channel}": must be alpha|beta|stable`);
  }
}

/**
 * Default tag scheme — matches the operator's manifest classifier
 * (apps/operator/app/api/updates/manifest/route.ts):
 *   alpha  → desktop-vX.Y.Z-alpha
 *   beta   → desktop-vX.Y.Z-beta
 *   stable → desktop-vX.Y.Z
 */
export function defaultTagFor(version: string, channel: Channel): string {
  return channel === 'stable'
    ? `desktop-v${version}`
    : `desktop-v${version}-${channel}`;
}

/** A GitHub release is a prerelease for any non-stable channel. */
export function isPrerelease(channel: Channel): boolean {
  return channel !== 'stable';
}
