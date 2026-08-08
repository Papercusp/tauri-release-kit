import { describe, it, expect } from 'vitest';
import {
  isValidVersion,
  assertValidVersion,
  isValidChannel,
  defaultTagFor,
  isPrerelease,
} from './tag.js';

describe('version validation', () => {
  it('accepts X.Y.Z and prereleases', () => {
    expect(isValidVersion('0.0.2')).toBe(true);
    expect(isValidVersion('1.2.3-alpha')).toBe(true);
    expect(isValidVersion('1.2.3-rc.1')).toBe(true);
  });
  it('rejects malformed versions', () => {
    expect(isValidVersion('1.2')).toBe(false);
    expect(isValidVersion('v1.2.3')).toBe(false);
    expect(isValidVersion('1.2.3-ALPHA')).toBe(false); // uppercase not allowed
    expect(isValidVersion('')).toBe(false);
  });
  it('assertValidVersion throws on bad input', () => {
    expect(() => assertValidVersion('nope')).toThrow(/invalid version/);
    expect(() => assertValidVersion('0.1.0')).not.toThrow();
  });
});

describe('channel validation', () => {
  it('recognizes every cuttable channel', () => {
    expect(isValidChannel('alpha')).toBe(true);
    expect(isValidChannel('beta')).toBe(true);
    expect(isValidChannel('stable')).toBe(true);
    // `nightly` became cuttable when the side-by-side channel model landed.
    // It is a channel you CUT and INSTALL, not a lane an install switches to —
    // that narrower question is `ChannelRegistry.updateLaneIds()`, and the two
    // sets are deliberately different.
    expect(isValidChannel('nightly')).toBe(true);
  });

  it('still rejects an unknown channel', () => {
    expect(isValidChannel('insider')).toBe(false);
    expect(isValidChannel('')).toBe(false);
    expect(isValidChannel('Alpha')).toBe(false);
  });
});

describe('defaultTagFor', () => {
  it('matches the operator manifest classifier scheme', () => {
    expect(defaultTagFor('0.0.2', 'stable')).toBe('desktop-v0.0.2');
    expect(defaultTagFor('0.0.3', 'beta')).toBe('desktop-v0.0.3-beta');
    expect(defaultTagFor('0.0.4', 'alpha')).toBe('desktop-v0.0.4-alpha');
  });
});

describe('isPrerelease', () => {
  it('is true for alpha/beta, false for stable', () => {
    expect(isPrerelease('alpha')).toBe(true);
    expect(isPrerelease('beta')).toBe(true);
    expect(isPrerelease('stable')).toBe(false);
  });
});
