import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAssetPlan, decodeImageResponse, generateAssets, type AssetSpec } from '../src/assets';
import { generationPrompt } from '../src/providers';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cS8AAAAASUVORK5CYII=';
const spec = (id: string): AssetSpec => ({ id, purpose: 'A growing plant', placement: 'Home hero', width: 512, height: 512, style: 'Green sticker', prompt: `An isolated ${id} sprout sticker`, background: 'transparent' });

test('asset plans reject excess images, path traversal and duplicate IDs before spending', () => {
  expect(parseAssetPlan({ style: 'minimal', assets: [] }).assets).toEqual([]);
  const sizes = parseAssetPlan({ style: 'editorial', assets: [{ ...spec('custom-mark'), width: 64, height: 64 }, { ...spec('cover'), width: 512, height: 768 }] });
  expect(sizes.assets.map(asset => [asset.width, asset.height])).toEqual([[64, 64], [512, 768]]);
  expect(() => parseAssetPlan({ style: 'sticker', assets: [spec('../bad')] })).toThrow('Asset IDs');
  expect(() => parseAssetPlan({ style: 'sticker', assets: [spec('same'), spec('same')] })).toThrow('unique');
  expect(() => parseAssetPlan({ style: 'sticker', assets: ['a','b','c','d'].map(spec) })).toThrow('three');
  expect(() => parseAssetPlan({ style: 'sticker', assets: [{ ...spec('tiny'), width: 0 }] })).toThrow('64–2048');
});

test('image decoding checks real file signatures and never downloads response URLs', () => {
  const decoded = decodeImageResponse({ data: [{ b64_json: png, media_type: 'image/png' }] });
  expect(decoded.mimeType).toBe('image/png');
  expect(decoded.width).toBe(1);
  expect(decoded.height).toBe(1);
  expect(() => decodeImageResponse({ data: [{ b64_json: Buffer.from('<script>no</script>').toString('base64') }] })).toThrow('not a supported');
  expect(() => decodeImageResponse({ data: [{ url: 'http://127.0.0.1/private' }] })).toThrow('not downloaded');
});

test('three images run concurrently and unchanged assets reuse verified content cache', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'exact-assets-'));
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-only-key';
  let calls = 0, active = 0, peak = 0;
  const events: any[] = [];
  const fetcher = (async (url: string, options: any) => {
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(JSON.parse(options.body).model).toBe('meta/muse-image');
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15)); active--;
    return Response.json({ data: [{ b64_json: png }], usage: { cost: 0.01 } });
  }) as typeof fetch;
  try {
    const plan = { style: 'Green sticker', assets: ['seed','sprout','bloom'].map(spec) };
    const assets = await generateAssets({ projectId: 'garden', plan, emit: event => events.push(event), cacheDir, fetcher, normalize: false });
    expect(peak).toBe(3);
    expect(calls).toBe(3);
    expect(events.filter(event => event.type === 'usage').length).toBe(3);
    expect(assets.every(asset => asset.path.includes(asset.sha256))).toBe(true);
    await generateAssets({ projectId: 'garden', plan, emit: event => events.push(event), cacheDir, fetcher, normalize: false });
    expect(calls).toBe(3);
    expect(events.filter(event => event.type === 'asset_cached').length).toBe(3);
    const changed = { ...plan, assets: plan.assets.map((asset, index) => index === 0 ? { ...asset, prompt: 'A red seed sticker' } : asset) };
    await generateAssets({ projectId: 'garden', plan: changed, emit: () => {}, cacheDir, fetcher, normalize: false });
    expect(calls).toBe(4);
    const prompt = await generationPrompt('garden', 'A plant tracker', undefined, undefined, undefined, assets);
    expect(prompt).toContain(assets[0].path);
    expect(prompt).toContain('GENERATED IMAGE MANIFEST');
    expect(prompt).not.toContain(cacheDir);
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey;
    await rm(cacheDir, { recursive: true, force: true });
  }
});
