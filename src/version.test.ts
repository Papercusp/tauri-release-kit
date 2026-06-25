import { describe, it, expect } from 'vitest';
import { bumpJson, bumpCargoToml, applyVersionBump } from './version.js';

describe('bumpJson', () => {
  it('rewrites the version field with 2-space indent + trailing newline', () => {
    const input = JSON.stringify({ name: 'x', version: '0.0.1' }, null, 2) + '\n';
    const out = bumpJson(input, '0.0.2');
    expect(out).toBe('{\n  "name": "x",\n  "version": "0.0.2"\n}\n');
  });
  it('preserves key order', () => {
    const out = bumpJson('{"a":1,"version":"0.0.1","z":2}', '9.9.9');
    expect(out).toBe('{\n  "a": 1,\n  "version": "9.9.9",\n  "z": 2\n}\n');
  });
  it('supports a dotted field path', () => {
    const out = bumpJson('{"package":{"version":"0.0.1"}}', '1.0.0', 'package.version');
    expect(JSON.parse(out).package.version).toBe('1.0.0');
  });
});

describe('bumpCargoToml', () => {
  it('rewrites only the first version line', () => {
    const input = [
      '[package]',
      'name = "app"',
      'version = "0.0.1"',
      '',
      '[dependencies]',
      'serde = { version = "1.0" }',
    ].join('\n');
    const out = bumpCargoToml(input, '0.0.2');
    expect(out).toContain('version = "0.0.2"');
    // the dependency's inline version is untouched
    expect(out).toContain('serde = { version = "1.0" }');
    expect(out.match(/^version = "0\.0\.2"$/m)).toBeTruthy();
    expect(out.match(/version = "0\.0\.1"/)).toBeNull();
  });
});

describe('applyVersionBump', () => {
  it('dispatches by kind', () => {
    expect(applyVersionBump({ path: 'p.json', kind: 'json' }, '{"version":"0.0.1"}', '2.0.0'))
      .toContain('"version": "2.0.0"');
    expect(applyVersionBump({ path: 'Cargo.toml', kind: 'cargo-toml' }, 'version = "0.0.1"', '2.0.0'))
      .toBe('version = "2.0.0"');
  });
});
