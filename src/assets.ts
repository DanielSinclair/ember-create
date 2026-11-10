import { decodeImageResponse } from './image-response';
export { decodeImageResponse } from './image-response';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, projectId } from './projects';
import { requestOpenRouter, type Emit } from './providers';

export type AssetSpec = {
  id: string; purpose: string; placement: string; width: number; height: number;
  style: string; prompt: string; background: 'transparent' | 'opaque';
};
export type AssetPlan = { style: string; assets: AssetSpec[] };
export type GeneratedAsset = AssetSpec & {
  path: string; file: string; sha256: string; mimeType: string; actualWidth: number | null;
  actualHeight: number | null; model: 'meta/muse-image';
  generatedWidth?: number | null; generatedHeight?: number | null; hasAlpha?: boolean;
};

const MODEL = 'meta/muse-image';

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const schema = {
  type: 'object', additionalProperties: false, required: ['style', 'assets'],
  properties: {
    style: { type: 'string' },
    assets: { type: 'array', maxItems: 3, items: {
      type: 'object', additionalProperties: false,
      required: ['id', 'purpose', 'placement', 'width', 'height', 'style', 'prompt', 'background'],
      properties: {
        ...Object.fromEntries(['id', 'purpose', 'placement', 'style', 'prompt'].map(key => [key, { type: 'string' }])),
        id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' },
        width: { type: 'integer', minimum: 64, maximum: 2048 }, height: { type: 'integer', minimum: 64, maximum: 2048 },
        background: { type: 'string', enum: ['transparent', 'opaque'] },
      },
    } },
  },
};

export function parseAssetPlan(value: unknown): AssetPlan {
  const plan: any = typeof value === 'string' ? JSON.parse(value) : value;
  if (!plan || typeof plan.style !== 'string' || plan.style.length > 1000 || !Array.isArray(plan.assets) || plan.assets.length > 3) throw new Error('Asset plan must contain a style and at most three images.');
  const ids = new Set<string>();
  const assets = plan.assets.map((asset: any) => {
    if (!asset || !/^[a-z][a-z0-9-]{0,47}$/.test(asset.id) || ids.has(asset.id)) throw new Error(`Asset IDs must be unique lowercase names, not paths or URLs (received ${JSON.stringify(asset?.id)}).`);
    ids.add(asset.id);
    for (const field of ['purpose', 'placement', 'style', 'prompt']) {
      if (typeof asset[field] !== 'string' || !asset[field].trim() || asset[field].length > 4000) throw new Error(`Asset ${asset.id} needs a bounded ${field}.`);
    }
    for (const field of ['width', 'height']) if (!Number.isInteger(asset[field]) || asset[field] < 64 || asset[field] > 2048) throw new Error(`Asset ${asset.id} ${field} must be 64–2048 pixels.`);
    if (!['transparent', 'opaque'].includes(asset.background)) throw new Error(`Asset ${asset.id} has an invalid background.`);
    return Object.fromEntries(['id', 'purpose', 'placement', 'width', 'height', 'style', 'prompt', 'background'].map(key => [key, asset[key]])) as AssetSpec;
  });
  return { style: plan.style, assets };
}

export async function planAssets({ prompt, image, previous, emit }: { prompt: string; image?: string; previous?: AssetPlan; emit: Emit }): Promise<AssetPlan> {
  emit({ type: 'status', message: 'Muse Ember is planning app artwork' });
  const response = await requestOpenRouter({
    model: 'meta/muse-ember', image, emit, schema, schemaName: 'asset_plan', maxTokens: 3500,
    prompt: `Plan the visual assets BEFORE coding this iOS app. Return the structured asset plan only. Plan 0–3 useful images; use 0 when images add no value or the user asks for none. Use SF Symbols for normal UI icons (back, settings, add, tabs); never generate those. Default illustrative artwork is a polished sticker with a clean silhouette, subtle dimensional shading, and a restrained die-cut edge, unless the user's style/reference calls for something else (photography, editorial, watercolor, etc.). User aesthetic wins. State one coherent overall style. Every image needs a stable lowercase kebab-case id (a-z, digits and hyphens ONLY, starts with a letter, maximum48 characters; example hero-sprout), specific purpose, exact screen/placement, intended pixel width/height, style, detailed standalone generation prompt, and transparent/opaque background. Choose dimensions by role, not a fixed 512px size: bespoke small icons 64–128px (up to 192px when detailed), stickers 256–512px, heroes 512–1024px, and portrait book covers about 512×768px. Standard interface icons still use SF Symbols. Describe rounded image/card embedding when appropriate; the UI applies actual corner clipping, so do not bake a fake UI frame into the art. Art must contain no UI text, labels, buttons, screenshot layouts, or fake data. Images for a growing subject should be coordinated stages or one adaptable graphic whose display size reflects real data. Prefer one strong hero over decorative clutter. The contract will receive the final local asset paths and MUST place these images. Reuse unchanged previous asset specs verbatim for cache reuse; only change the image prompt/style when the requested edit needs different artwork. Do not include URLs or filesystem paths.\nRequest:\n${prompt}${previous ? `\nPrevious plan:\n${JSON.stringify(previous)}` : ''}`,
  });
  const plan = parseAssetPlan(response);
  emit({ type: 'asset_plan', message: `Planned ${plan.assets.length} app image${plan.assets.length === 1 ? '' : 's'}${plan.assets.map(asset => `\n${asset.id}: ${asset.purpose}; ${asset.placement}; ${asset.width}×${asset.height}; ${asset.style}`).join('')}`, plan });
  return plan;
}


export async function normalizeAsset(asset: GeneratedAsset, cacheDir = join(DATA, 'asset-cache')): Promise<GeneratedAsset> {
  const index = join(cacheDir, `${asset.sha256}-${asset.width}x${asset.height}-png.json`);
  try {
    const cached = JSON.parse(await readFile(index, 'utf8'));
    const file = join(cacheDir, `${cached.sha256}.png`);
    if (digest(await readFile(file)) === cached.sha256) return { ...asset, ...cached, file, path: asset.path.replace(/[^/]+$/, `${asset.id}-${cached.sha256}.png`) };
  } catch (error: any) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const temporary = join(cacheDir, `${crypto.randomUUID()}.png`);
  const run = promisify(execFile);
  const scale = asset.actualWidth && asset.actualHeight ? Math.min(1, asset.width / asset.actualWidth, asset.height / asset.actualHeight) : 1;
  const longestSide = asset.actualWidth && asset.actualHeight ? Math.max(1, Math.floor(Math.max(asset.actualWidth, asset.actualHeight) * scale)) : Math.min(asset.width, asset.height);
  await run('/usr/bin/sips', ['-s', 'format', 'png', '--resampleHeightWidthMax', String(longestSide), asset.file, '--out', temporary]);
  const decoded = decodeImageResponse({ data: [{ b64_json: (await readFile(temporary)).toString('base64') }] });
  const sha256 = digest(decoded.bytes), file = join(cacheDir, `${sha256}.png`);
  const alpha = await run('/usr/bin/sips', ['-g', 'hasAlpha', temporary]);
  const info = { sha256, mimeType: 'image/png', actualWidth: decoded.width, actualHeight: decoded.height, generatedWidth: asset.generatedWidth ?? asset.actualWidth, generatedHeight: asset.generatedHeight ?? asset.actualHeight, hasAlpha: /hasAlpha:\s*yes/.test(alpha.stdout) };
  await rename(temporary, file);
  await writeFile(index, JSON.stringify(info));
  return { ...asset, ...info, file, path: asset.path.replace(/[^/]+$/, `${asset.id}-${sha256}.png`) };
}

export async function generateAssets({ projectId: id, plan: input, emit, cacheDir = join(DATA, 'asset-cache'), fetcher = fetch, normalize = true }: {
  projectId: string; plan: AssetPlan; emit: Emit; cacheDir?: string; fetcher?: typeof fetch; normalize?: boolean;
}): Promise<GeneratedAsset[]> {
  projectId(id);
  const plan = parseAssetPlan(input);
  await mkdir(cacheDir, { recursive: true });
  const results: GeneratedAsset[] = new Array(plan.assets.length);
  let next = 0, completed = 0;
  const failures: Error[] = [];
  async function produce(spec: AssetSpec, index: number): Promise<GeneratedAsset> {
    const key = digest(JSON.stringify({ model: MODEL, style: plan.style, spec }));
    const record = join(cacheDir, `${key}.json`);
    try {
      const cached = JSON.parse(await readFile(record, 'utf8'));
      if (/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(cached.filename)) {
        const file = join(cacheDir, cached.filename), bytes = await readFile(file);
        if (digest(bytes) === cached.sha256) {
          emit({ type: 'asset_cached', message: `Reusing ${spec.id} (${index + 1}/${plan.assets.length})`, assetId: spec.id, index: index + 1, completed, total: plan.assets.length });
          return { ...spec, ...cached.info, file, path: `assets/generated/${id}/${spec.id}-${cached.filename}`, sha256: cached.sha256, model: MODEL };
        }
      }
    } catch (error: any) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('Set OPENROUTER_API_KEY to generate images with Muse Image.');
    emit({ type: 'asset_started', message: `Muse Image is drawing ${spec.id} (${index + 1}/${plan.assets.length})`, assetId: spec.id, index: index + 1, completed, total: plan.assets.length });
    // The live Muse Image catalog exposes no optional parameters; only model/prompt are sent.
    const response = await fetcher('https://openrouter.ai/api/v1/images', {
      method: 'POST', signal: AbortSignal.timeout(180_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Exact Create' },
      body: JSON.stringify({ model: MODEL, prompt: `${spec.prompt}\nArt direction: ${plan.style}. ${spec.style}. Intended app placement: ${spec.placement}. Target canvas: ${spec.width}×${spec.height} pixels. ${spec.background === 'transparent' ? 'Transparent background, isolated subject, no checkerboard pattern.' : 'Opaque background matching the requested composition.'} No UI text, labels, buttons, or watermark.` }),
    });
    const body: any = await response.json();
    if (body.usage) emit({ type: 'usage', message: `Muse Image completed ${spec.id}`, stage: 'asset_image', assetId: spec.id, model: MODEL, usage: body.usage });
    if (!response.ok || body.error) throw new Error(`Muse Image ${spec.id}: ${body.error?.message || response.status}`);
    const decoded = decodeImageResponse(body);
    const sha256 = digest(decoded.bytes), filename = `${sha256}.${decoded.extension}`, file = join(cacheDir, filename);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await writeFile(temp, decoded.bytes); await rename(temp, file);
    const info = { mimeType: decoded.mimeType, actualWidth: decoded.width, actualHeight: decoded.height };
    const recordTemp = `${record}.${crypto.randomUUID()}.tmp`;
    await writeFile(recordTemp, JSON.stringify({ filename, sha256, info })); await rename(recordTemp, record);
    return { ...spec, ...info, file, path: `assets/generated/${id}/${spec.id}-${filename}`, sha256, model: MODEL };
  }
  await Promise.all(Array.from({ length: Math.min(3, plan.assets.length) }, async () => {
    while (next < plan.assets.length) {
      const index = next++, spec = plan.assets[index];
      try {
        const generated = await produce(spec, index);
        results[index] = normalize ? await normalizeAsset(generated, cacheDir) : generated; completed++;
        emit({ type: 'asset_ready', message: `Artwork ready: ${spec.id} (${completed}/${plan.assets.length})`, assetId: spec.id, index: index + 1, path: results[index].path, completed, total: plan.assets.length });
      } catch (error: any) {
        failures.push(error);
        emit({ type: 'asset_error', message: error.message || String(error), assetId: spec.id });
      }
    }
  }));
  if (failures.length) throw new AggregateError(failures, `Could not generate ${failures.length} app image(s): ${failures.map(error => error.message).join('; ')}`);
  return results;
}
