import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { materializeProjectAssets } from '../tools/container.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+1sAAAAASUVORK5CYII=', 'base64');
const sha256 = createHash('sha256').update(png).digest('hex');
describe('generated preview assets', () => {
  test('copies verified PNGs to the contract path without touching app icons', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exact-assets-'));
    try {
      const file = join(dir, 'source.png'); writeFileSync(file, png);
      const path = `assets/generated/test-app/hero-${sha256}.png`;
      const result = materializeProjectAssets({ projectId: 'test-app', assets: [{ path, file, sha256 }] }, dir);
      expect(result).toEqual({ assetsStaged: 1, assetBytes: png.length });
      expect(readFileSync(join(dir, path))).toEqual(png);
    } finally { rmSync(dir, { recursive: true }); }
  });
  test('rejects traversal, other projects, mutable paths and changed content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exact-assets-'));
    try {
      const file = join(dir, 'source.png'); writeFileSync(file, png);
      for (const path of [`assets/generated/test-app/../hero-${sha256}.png`, `assets/generated/other/hero-${sha256}.png`, 'assets/generated/test-app/hero.png']) {
        expect(() => materializeProjectAssets({ projectId: 'test-app', assets: [{ path, file, sha256 }] }, dir)).toThrow();
      }
      expect(() => materializeProjectAssets({ projectId: 'test-app', assets: [{ path: `assets/generated/test-app/hero-${sha256}.png`, file, sha256: 'bad' }] }, dir)).toThrow('hash');
      expect(() => materializeProjectAssets({ projectId: 'test-app', assets: [{ path: `assets/generated/test-app/hero-${sha256}.jpg`, file, sha256 }] }, dir)).toThrow('bytes');
    } finally { rmSync(dir, { recursive: true }); }
  });
});

test('legacy modules receive the fixed OpenRouter ceiling and declared environment reads', async () => {
  const { GRANTS, normalizeModule } = await import('../tools/container.mjs');
  const module = normalizeModule('export const grants = "fs.read app:/data\\nfs.write app:/data";\nexport const answer = () => 1;');
  expect(module).toContain(JSON.stringify(GRANTS));
  expect(module).toContain('import.meta.env.OPENROUTER_API_KEY');
  expect(module).not.toContain('MUSE_GATEWAY_URL');
  expect(normalizeModule(module)).toBe(module);
});


test('Muse imports configure the local key once and migrate the retired gateway ceiling', async () => {
  const { GRANTS, normalizeModule } = await import('../tools/container.mjs');
  const legacy = 'fs.read app:/data\\nfs.write app:/data\\ndevice.health-read purpose.health\\nnet.fetch https://ember-create-gateway.vercel.app';
  const module = normalizeModule(`import { museText } from './muse';\nexport const grants = "${legacy}";`);
  expect(module).toContain(JSON.stringify(GRANTS));
  expect(module).toContain('__configureMuse(__museKey)');
  expect(normalizeModule(module)).toBe(module);
});

test('a static first project retains the shared container Health module', async () => {
  const { containerContract } = await import('../tools/container.mjs');
  const source = containerContract('component App\n  view\n    text "Hello"\n');
  expect(source).toContain('use healthStatus as exactCreateHealthStatus from "@exact/health"');
  expect(containerContract(source)).toBe(source);
  const health = 'use healthStatus from "@exact/health"\ncomponent App\n  view\n    text "Hello"\n';
  expect(containerContract(health)).toBe(health);
});
