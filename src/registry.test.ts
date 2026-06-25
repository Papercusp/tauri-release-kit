import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerTargetDriver,
  resolveTargetDriver,
  hasTargetDriver,
  listTargetDrivers,
  clearTargetDrivers,
} from './registry.js';
import type { TargetDriver } from './types.js';

const fakeDriver = (key: string): TargetDriver => ({
  key,
  build: async () => [],
});

describe('target-driver registry', () => {
  beforeEach(() => clearTargetDrivers());

  it('registers + resolves by key', () => {
    registerTargetDriver(fakeDriver('linux-x86_64'));
    expect(hasTargetDriver('linux-x86_64')).toBe(true);
    expect(resolveTargetDriver('linux-x86_64').key).toBe('linux-x86_64');
    expect(listTargetDrivers()).toEqual(['linux-x86_64']);
  });

  it('throws a helpful error for an unknown key', () => {
    registerTargetDriver(fakeDriver('linux-x86_64'));
    expect(() => resolveTargetDriver('windows-x86_64')).toThrow(/no build target driver/);
    expect(() => resolveTargetDriver('windows-x86_64')).toThrow(/linux-x86_64/);
  });

  it('last registration for a key wins', () => {
    const a = fakeDriver('macos-universal');
    const b = fakeDriver('macos-universal');
    registerTargetDriver(a);
    registerTargetDriver(b);
    expect(resolveTargetDriver('macos-universal')).toBe(b);
  });
});
