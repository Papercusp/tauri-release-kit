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
  it('recognizes the three channels', () => {
    expect(isValidChannel('alpha')).toBe(true);
    expect(isValidChannel('beta')).toBe(true);
    expect(isValidChannel('stable')).toBe(true);
    expect(isValidChannel('nightly')).toBe(false);
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
