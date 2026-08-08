import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANIFEST_NAME,
  type AppIdentity,
  type ChannelSpec,
  type ResolvedChannel,
  defineChannelRegistry,
  resolveChannelIdentity,
} from './channels.js';

const BASE: AppIdentity = {
  bundleId: 'com.example.gui',
  productName: 'Example GUI',
  dataHomeDirName: '.example',
};

/** A registry shaped like a real one: three update lanes + one side-by-side. */
function fourChannelSpecs(): ChannelSpec[] {
  return [
    { id: 'alpha', distribution: 'update-lane', rootFeed: true, prerelease: true, promotesFrom: ['nightly'] },
    { id: 'beta', distribution: 'update-lane', rootFeed: true, prerelease: true, strict: true, promotesFrom: ['alpha'] },
    { id: 'stable', distribution: 'update-lane', rootFeed: true, strict: true, promotesFrom: ['beta'] },
    { id: 'nightly', distribution: 'side-by-side', identitySuffix: 'nightly', prerelease: true },
  ];
}

const registry = () => defineChannelRegistry(fourChannelSpecs());

describe('defineChannelRegistry — construction', () => {
  it('resolves defaults and preserves declaration order', () => {
    const r = registry();
    expect(r.ids()).toEqual(['alpha', 'beta', 'stable', 'nightly']);
    const alpha = r.get('alpha');
    expect(alpha.rootFeed).toBe(true);
    expect(alpha.strict).toBe(false);
    expect(alpha.identitySuffix).toBeNull();
    expect(r.get('stable').prerelease).toBe(false);
    expect(r.get('nightly').identityLabel).toBe('Nightly');
  });

  it('rejects an empty registry', () => {
    expect(() => defineChannelRegistry([])).toThrow(/at least one channel/);
  });

  it('rejects a duplicate id', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'alpha', distribution: 'update-lane', rootFeed: true },
        { id: 'alpha', distribution: 'update-lane' },
      ]),
    ).toThrow(/declared twice/);
  });

  it('rejects a non-slug id — it becomes a URL segment and part of a bundle id', () => {
    for (const bad of ['Alpha', 'al pha', 'alpha/beta', '../escape', '', 'alpha_beta']) {
      expect(() =>
        defineChannelRegistry([{ id: bad, distribution: 'update-lane', rootFeed: true }]),
      ).toThrow(/lowercase slug/);
    }
  });
});

describe('the ROOT FEED invariant — the address shipped binaries poll forever', () => {
  it('requires at least one publisher — with none, the permanent address goes stale', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'alpha', distribution: 'update-lane' },
        { id: 'stable', distribution: 'update-lane' },
      ]),
    ).toThrow(/at least one channel must set rootFeed/);
  });

  it('ALLOWS several update lanes to publish to the root manifest', () => {
    // The root manifest legitimately means "the most recent cut, whatever lane",
    // with the lane gate applied downstream by whatever reads it. Forcing a
    // single owner here would stop the other lanes publishing at all.
    const ids = registry()
      .rootFeedChannels()
      .map((c) => c.id);
    expect(ids).toEqual(['alpha', 'beta', 'stable']);
  });

  it('REFUSES a side-by-side channel that claims the root manifest', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'alpha', distribution: 'update-lane', rootFeed: true },
        {
          id: 'nightly',
          distribution: 'side-by-side',
          identitySuffix: 'nightly',
          rootFeed: true,
        },
      ]),
    ).toThrow(/must NOT set rootFeed/);
  });

  it('a root publisher writes BOTH its per-channel feed and the root manifest', () => {
    expect(registry().feedPathsFor('alpha')).toEqual(['alpha/latest.json', 'latest.json']);
    expect(registry().feedPathsFor('stable')).toEqual(['stable/latest.json', 'latest.json']);
  });

  it('a side-by-side channel publishes ONLY its own feed — it never touches the permanent address', () => {
    const paths = registry().feedPathsFor('nightly');
    expect(paths).toEqual(['nightly/latest.json']);
    expect(paths).not.toContain(DEFAULT_MANIFEST_NAME);
  });

  it('writes the root manifest LAST, so a partial publish leaves it on the last known good release', () => {
    const paths = registry().feedPathsFor('alpha');
    expect(paths[paths.length - 1]).toBe(DEFAULT_MANIFEST_NAME);
    expect(paths.indexOf('alpha/latest.json')).toBeLessThan(paths.indexOf(DEFAULT_MANIFEST_NAME));
  });

  it('honors a custom manifest name on both legs', () => {
    expect(registry().feedPathsFor('alpha', 'latest-server.json')).toEqual([
      'alpha/latest-server.json',
      'latest-server.json',
    ]);
  });

  /**
   * CONTROL — the naive layout this model exists to prevent: "every channel just
   * writes the root manifest". It type-checks, it looks symmetric, and it means
   * whichever channel was cut most recently is what every install receives.
   */
  it('CONTROL: a naive layout that always writes the root fails the non-root assertion', () => {
    const naiveFeedPaths = (id: string) => [`${id}/latest.json`, 'latest.json'];
    expect(naiveFeedPaths('nightly')).toContain(DEFAULT_MANIFEST_NAME);
    expect(registry().feedPathsFor('nightly')).not.toContain(DEFAULT_MANIFEST_NAME);
  });
});

describe('feed URLs', () => {
  it('builds a per-channel URL under the base', () => {
    expect(registry().feedUrlFor('beta', 'https://host.example/s3cret')).toBe(
      'https://host.example/s3cret/beta/latest.json',
    );
  });

  it('tolerates a trailing slash on the base', () => {
    expect(registry().feedUrlFor('beta', 'https://host.example/s3cret/')).toBe(
      'https://host.example/s3cret/beta/latest.json',
    );
  });

  it('the per-channel URL is never the root URL', () => {
    const r = registry();
    const base = 'https://host.example/s3cret';
    for (const id of r.ids()) {
      expect(r.feedUrlFor(id, base)).not.toBe(`${base}/${DEFAULT_MANIFEST_NAME}`);
    }
  });
});

describe('the DATA HOME invariant — a side-by-side build must never share state', () => {
  it('an update lane inherits the base identity unchanged, so switching lanes keeps user state', () => {
    const r = registry();
    for (const id of ['alpha', 'beta', 'stable']) {
      const identity = r.resolveIdentity(id, BASE);
      expect(identity.sideBySide).toBe(false);
      expect(identity.bundleId).toBe(BASE.bundleId);
      expect(identity.productName).toBe(BASE.productName);
      expect(identity.dataHomeDirName).toBe(BASE.dataHomeDirName);
      expect(identity.channel).toBe(id);
    }
  });

  it('a side-by-side channel gets its own bundle id, name and data home', () => {
    const identity = registry().resolveIdentity('nightly', BASE);
    expect(identity).toMatchObject({
      bundleId: 'com.example.gui.nightly',
      productName: 'Example GUI Nightly',
      dataHomeDirName: '.example-nightly',
      sideBySide: true,
      channel: 'nightly',
    });
  });

  it('the side-by-side data home and bundle id differ from the base — asserted, not assumed', () => {
    const identity = registry().resolveIdentity('nightly', BASE);
    expect(identity.dataHomeDirName).not.toBe(BASE.dataHomeDirName);
    expect(identity.bundleId).not.toBe(BASE.bundleId);
  });

  it('rejects a side-by-side channel with no identitySuffix at CONSTRUCTION', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'alpha', distribution: 'update-lane', rootFeed: true },
        { id: 'nightly', distribution: 'side-by-side' },
      ]),
    ).toThrow(/MUST declare a non-empty identitySuffix/);
  });

  it('rejects a whitespace-only identitySuffix', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'alpha', distribution: 'update-lane', rootFeed: true },
        { id: 'nightly', distribution: 'side-by-side', identitySuffix: '   ' },
      ]),
    ).toThrow(/MUST declare a non-empty identitySuffix/);
  });

  it('rejects two side-by-side channels sharing an identitySuffix', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'alpha', distribution: 'update-lane', rootFeed: true },
        { id: 'nightly', distribution: 'side-by-side', identitySuffix: 'dev' },
        { id: 'canary', distribution: 'side-by-side', identitySuffix: 'dev' },
      ]),
    ).toThrow(/already used by channel "nightly"/);
  });

  it('rejects an update lane that declares an identity — that would silently be a second install', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'alpha', distribution: 'update-lane', rootFeed: true, identitySuffix: 'alpha' },
      ]),
    ).toThrow(/must NOT declare an identitySuffix/);
  });

  it('uses an explicit identityLabel for the product name when given', () => {
    const r = defineChannelRegistry([
      { id: 'alpha', distribution: 'update-lane', rootFeed: true },
      {
        id: 'nightly',
        distribution: 'side-by-side',
        identitySuffix: 'nightly',
        identityLabel: 'Nightly (unstable)',
      },
    ]);
    expect(r.resolveIdentity('nightly', BASE).productName).toBe('Example GUI Nightly (unstable)');
  });

  it('capitalizes a multi-word suffix for the default label', () => {
    const r = defineChannelRegistry([
      { id: 'alpha', distribution: 'update-lane', rootFeed: true },
      { id: 'nb', distribution: 'side-by-side', identitySuffix: 'nightly-build' },
    ]);
    expect(r.resolveIdentity('nb', BASE).productName).toBe('Example GUI Nightly Build');
  });

  /**
   * CONTROL — a hand-built ResolvedChannel that claims side-by-side without an
   * identity. `defineChannelRegistry` makes this unreachable, but the exported
   * resolver is reachable on its own, and the failure it guards (a nightly build
   * opening the working app's state directory) is silent and destructive.
   */
  it('CONTROL: resolveChannelIdentity refuses a hand-built side-by-side with no suffix', () => {
    const forged: ResolvedChannel = {
      id: 'rogue',
      distribution: 'side-by-side',
      rootFeed: false,
      identitySuffix: null,
      identityLabel: null,
      promotesFrom: [],
      strict: false,
      prerelease: true,
    };
    expect(() => resolveChannelIdentity(forged, BASE)).toThrow(
      /would share the base app's data home/,
    );
  });

  /**
   * CALIBRATION for the two controls above: the REAL subject must pass the same
   * assertions the controls fail, or the controls prove nothing.
   */
  it('CALIBRATION: the real registry resolves every channel without throwing', () => {
    const r = registry();
    const homes = r.ids().map((id) => r.resolveIdentity(id, BASE).dataHomeDirName);
    expect(homes).toEqual(['.example', '.example', '.example', '.example-nightly']);
  });
});

describe('the promotion graph', () => {
  it('reports direct sources', () => {
    const r = registry();
    expect(r.promotionSourcesFor('stable')).toEqual(['beta']);
    expect(r.promotionSourcesFor('alpha')).toEqual(['nightly']);
    expect(r.promotionSourcesFor('nightly')).toEqual([]);
  });

  it('rejects an unknown promotion source', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'alpha', distribution: 'update-lane', rootFeed: true, promotesFrom: ['ghost'] },
      ]),
    ).toThrow(/unknown channel "ghost"/);
  });

  it('rejects a self-edge', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'alpha', distribution: 'update-lane', rootFeed: true, promotesFrom: ['alpha'] },
      ]),
    ).toThrow(/cannot name itself/);
  });

  it('rejects a two-node cycle', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'alpha', distribution: 'update-lane', rootFeed: true, promotesFrom: ['beta'] },
        { id: 'beta', distribution: 'update-lane', promotesFrom: ['alpha'] },
      ]),
    ).toThrow(/promotion cycle/);
  });

  it('rejects a longer cycle', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'a', distribution: 'update-lane', rootFeed: true, promotesFrom: ['b'] },
        { id: 'b', distribution: 'update-lane', promotesFrom: ['c'] },
        { id: 'c', distribution: 'update-lane', promotesFrom: ['a'] },
      ]),
    ).toThrow(/promotion cycle/);
  });

  it('accepts a diamond — shared sources are not cycles', () => {
    expect(() =>
      defineChannelRegistry([
        { id: 'src', distribution: 'update-lane', rootFeed: true },
        { id: 'left', distribution: 'update-lane', promotesFrom: ['src'] },
        { id: 'right', distribution: 'update-lane', promotesFrom: ['src'] },
        { id: 'top', distribution: 'update-lane', promotesFrom: ['left', 'right'] },
      ]),
    ).not.toThrow();
  });
});

describe('unknown ids fail loudly', () => {
  it('get / feedPathsFor / feedUrlFor / resolveIdentity all throw and name the valid ids', () => {
    const r = registry();
    for (const call of [
      () => r.get('insider'),
      () => r.feedPathsFor('insider'),
      () => r.feedUrlFor('insider', 'https://host.example/x'),
      () => r.resolveIdentity('insider', BASE),
      () => r.promotionSourcesFor('insider'),
    ]) {
      expect(call).toThrow(/unknown channel "insider": must be one of alpha, beta, stable, nightly/);
    }
  });

  it('has() answers without throwing', () => {
    const r = registry();
    expect(r.has('nightly')).toBe(true);
    expect(r.has('insider')).toBe(false);
  });
});

describe('immutability — a registry handed around cannot be edited under a caller', () => {
  it('freezes the channel list and each entry', () => {
    const r = registry();
    expect(Object.isFrozen(r.all())).toBe(true);
    expect(Object.isFrozen(r.get('alpha'))).toBe(true);
    expect(Object.isFrozen(r.resolveIdentity('nightly', BASE))).toBe(true);
  });

  it('is not affected by later mutation of the specs array', () => {
    const specs = fourChannelSpecs();
    const r = defineChannelRegistry(specs);
    specs.push({ id: 'rogue', distribution: 'update-lane' });
    expect(r.ids()).not.toContain('rogue');
  });
});
