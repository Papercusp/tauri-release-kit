import { describe, it, expect } from 'vitest';
import { parsePublishArgs, targetKeyForPlatform } from './cli.js';
import { CHANNELS } from './tag.js';

describe('parsePublishArgs', () => {
  it('parses the documented shape: publish --platform <p> --incremental <ver> <channel>', () => {
    const args = parsePublishArgs(['publish', '--platform', 'darwin', '--incremental', '0.0.13', 'alpha']);
    expect(args).toEqual({
      platform: 'darwin',
      targetKey: 'macos-universal',
      version: '0.0.13',
      channel: 'alpha',
      incremental: true,
    });
  });

  it('flag order after the subcommand does not matter', () => {
    const args = parsePublishArgs(['publish', '0.0.13', '--incremental', 'stable', '--platform', 'linux']);
    expect(args.platform).toBe('linux');
    expect(args.version).toBe('0.0.13');
    expect(args.channel).toBe('stable');
  });

  it.each([
    ['linux', 'linux-x86_64'],
    ['darwin', 'macos-universal'],
    ['windows', 'windows-x86_64'],
  ] as const)('maps --platform %s to TargetKey %s', (platform, targetKey) => {
    expect(targetKeyForPlatform(platform)).toBe(targetKey);
  });

  it('rejects a missing subcommand', () => {
    expect(() => parsePublishArgs([])).toThrow(/expected subcommand "publish"/);
    expect(() => parsePublishArgs(['bogus'])).toThrow(/expected subcommand "publish"/);
  });

  it('rejects a missing --platform', () => {
    expect(() => parsePublishArgs(['publish', '--incremental', '0.0.13', 'alpha'])).toThrow(/--platform/);
  });

  it('rejects an unknown --platform value', () => {
    expect(() =>
      parsePublishArgs(['publish', '--platform', 'freebsd', '--incremental', '0.0.13', 'alpha']),
    ).toThrow(/linux\|darwin\|windows/);
  });

  it('rejects publish without --incremental — not implemented yet, and says so', () => {
    expect(() => parsePublishArgs(['publish', '--platform', 'linux', '0.0.13', 'alpha'])).toThrow(
      /not implemented/,
    );
  });

  it('rejects a missing version/channel', () => {
    expect(() => parsePublishArgs(['publish', '--platform', 'linux', '--incremental'])).toThrow(
      /missing <version>/,
    );
    expect(() => parsePublishArgs(['publish', '--platform', 'linux', '--incremental', '0.0.13'])).toThrow(
      /missing <channel>/,
    );
  });

  it('rejects an invalid channel', () => {
    // `nightly` was this probe's example of an invalid channel until it became a
    // real (side-by-side) one — `insider` is a name that genuinely is not.
    expect(() =>
      parsePublishArgs(['publish', '--platform', 'linux', '--incremental', '0.0.13', 'insider']),
    ).toThrow(/channel must be alpha\|beta\|stable\|nightly/);
  });

  it('accepts every channel the kit declares', () => {
    // Guards the drift this message used to invite: the error text is derived
    // from CHANNELS, so a channel added to the union cannot be rejected here
    // while claiming to be valid elsewhere.
    for (const channel of CHANNELS) {
      expect(
        parsePublishArgs(['publish', '--platform', 'linux', '--incremental', '0.0.13', channel])
          .channel,
      ).toBe(channel);
    }
  });

  it('rejects an unknown flag', () => {
    expect(() =>
      parsePublishArgs(['publish', '--platform', 'linux', '--incremental', '--bogus', '0.0.13', 'alpha']),
    ).toThrow(/unknown flag/);
  });
});
