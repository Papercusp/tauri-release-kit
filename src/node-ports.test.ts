import { describe, it, expect } from 'vitest';
import { nodePorts } from './node-ports.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('node-ports (real fs + subprocess)', () => {
  const ports = nodePorts({ inheritStdio: false });

  it('fs round-trips text, exists, and lists the dir', async () => {
    const f = join(tmpdir(), `trk-${process.pid}-${Date.now()}.txt`);
    await ports.fs.writeText(f, 'hello');
    expect(await ports.fs.exists(f)).toBe(true);
    expect(await ports.fs.readText(f)).toBe('hello');
    expect(await ports.fs.readDir(tmpdir())).toContain(f.split('/').pop());
  });

  it('exists=false + readDir=[] for missing paths (no throw)', async () => {
    expect(await ports.fs.exists('/no/such/path/xyz123')).toBe(false);
    expect(await ports.fs.readDir('/no/such/dir/xyz123')).toEqual([]);
  });

  it('exec captures stdout + exit code', async () => {
    const ok = await ports.exec.run('node', ['-e', "process.stdout.write('hi')"]);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toBe('hi');
    const fail = await ports.exec.run('node', ['-e', 'process.exit(3)']);
    expect(fail.code).toBe(3);
  });

  it('exec passes env through', async () => {
    const r = await ports.exec.run('node', ['-e', 'process.stdout.write(process.env.TRK_X || "")'], {
      env: { TRK_X: 'yes' },
    });
    expect(r.stdout).toBe('yes');
  });

  it('env + now', () => {
    process.env.TRK_TEST_VAR = 'v1';
    expect(ports.env('TRK_TEST_VAR')).toBe('v1');
    expect(ports.now()).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});
