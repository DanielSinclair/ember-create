import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { materializeProjectAssets } from '../tools/container.mjs';
import type { AssetPlan, GeneratedAsset } from './assets';

export const ROOT = resolve(import.meta.dir, '..');
export const DATA = process.env.EXACT_CREATE_HOME || join(ROOT, '.exact-create');
export type Artifact = { name: string; contract: string; typescript: string; tests: string };
export type Metadata = { id: string; name: string; description: string };
export type Project = Artifact & { id: string; description?: string; demo?: boolean; demoVersion?: number; demoSourceHash?: string; assetPlan?: AssetPlan; assets?: GeneratedAsset[]; prompt: string; provider: string; createdAt: string; updatedAt: string };

export const DEMO_IDS = ['pedometer', 'water', 'hydration', 'focus', 'budget', 'ferry', 'pantry', 'mood', 'weekend', 'reading'];
const legacyDemoHashes: Record<string, string> = {"pedometer": "d946fc6c062f11b0cba050b76b1a8d5b66aea498e793079a396c9377884fc56b", "water": "64de7e18f0041ef51800cd9c2a28f1932eaef6ad5ee4a0ae5f481fbc07ee6ecc", "hydration": "a414ad462dc31bbaa9344dabdd59f02bafee60f5bbe1129151ef98ec0f419a2a", "focus": "69f134b67ea8c29f42e19d4b4f9678ca581aa704ff4a7df5df5f44651a1b29d5"};
function sourceHash(project: Artifact) {
  return createHash('sha256').update([project.contract, project.typescript, project.tests].join('\0')).digest('hex');
}
async function optionalJSON(path: string, fallback: any) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error: any) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function seedDemos(destination = DATA) {
  const projects = join(destination, 'projects');
  await mkdir(projects, { recursive: true });
  for (const id of DEMO_IDS) {
    const source = join(ROOT, 'demos', id);
    const [metadata, contract, typescript, tests, assets, assetPlan] = await Promise.all([
      readFile(join(source, 'demo.json'), 'utf8').then(JSON.parse),
      readFile(join(source, 'app.contract'), 'utf8'),
      readFile(join(source, 'app.ts'), 'utf8'),
      readFile(join(source, 'app.test.contract'), 'utf8'),
      optionalJSON(join(source, 'assets.json'), []),
      optionalJSON(join(source, 'assets.plan.json'), undefined),
    ]);
    const dir = join(projects, id);
    const current = await optionalJSON(join(dir, 'project.json'), null);
    if (current) {
      const unchanged = current.demo && typeof current.contract === 'string' && sourceHash(current) === (current.demoSourceHash || legacyDemoHashes[id]);
      if (!unchanged || sourceHash(current) === sourceHash({ name: metadata.name, contract, typescript, tests })) continue;
    }
    await mkdir(dir, { recursive: true });
    materializeProjectAssets({ projectId: id, assets: assets.map((asset: GeneratedAsset) => ({ ...asset, file: join(source, asset.path) })) }, dir);
    await Promise.all([
      writeFile(join(dir, 'app.contract'), contract),
      writeFile(join(dir, 'app.ts'), typescript),
      writeFile(join(dir, 'app.test.contract'), tests),
    ]);
    const project = { ...metadata, id, demo: true, contract, typescript, tests, assetPlan,
      assets: assets.map((asset: GeneratedAsset) => ({ ...asset, file: join(dir, asset.path) })) };
    await atomicJSON(join(dir, 'project.json'), { ...project, demoSourceHash: sourceHash(project) });
  }
}

let demosReady: Promise<void> | undefined;
function ensureDemos() {
  return demosReady ??= seedDemos().catch(error => { demosReady = undefined; throw error; });
}

export function projectId(value: string): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw new Error('Project ID must start with a letter and contain only lowercase letters, numbers, or hyphens (64 max).');
  return value;
}
export function makeId(prompt: string): string {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'app';
  return projectId(`${/^[a-z]/.test(slug) ? slug : `app-${slug}`}-${Date.now().toString(36)}`);
}
export function parseMetadata(raw: string): Metadata {
  const value = JSON.parse(raw);
  if (typeof value.id !== 'string') throw new Error('Generated metadata is missing its project ID');
  projectId(value.id);
  for (const [field, limit] of [['name', 80], ['description', 500]] as const) {
    if (typeof value[field] !== 'string' || !value[field].trim() || value[field].length > limit) {
      throw new Error(`Generated metadata needs a non-empty ${field} of at most ${limit} characters`);
    }
  }
  return { id: value.id, name: value.name.trim(), description: value.description.trim() };
}
export function availableId(id: string, existing: Iterable<string>): string {
  projectId(id);
  const taken = new Set(existing);
  if (!taken.has(id)) return id;
  for (let suffix = 2; ; suffix++) {
    const ending = `-${suffix}`;
    const candidate = id.slice(0, 64 - ending.length) + ending;
    if (!taken.has(candidate)) return candidate;
  }
}
export async function atomicJSON(file: string, value: unknown) {
  await mkdir(resolve(file, '..'), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, file);
}
export async function getProject(id: string): Promise<Project> {
  projectId(id);
  await ensureDemos();
  const dir = join(DATA, 'projects', projectId(id));
  const project = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'));
  if (project.assets) project.assets = project.assets.map((asset: GeneratedAsset) => ({ ...asset, file: join(dir, asset.path) }));
  return project;
}
export async function listProjects(): Promise<Project[]> {
  await ensureDemos();
  let entries: string[];
  try { entries = await readdir(join(DATA, 'projects')); }
  catch (e: any) { if (e.code === 'ENOENT') return []; throw e; }
  const projects = await Promise.all(entries.filter(id => /^[a-z][a-z0-9-]{0,63}$/.test(id)).map(getProject));
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveProject(project: Project) {
  const dir = join(DATA, 'projects', projectId(project.id));
  await mkdir(dir, { recursive: true });
  materializeProjectAssets({ projectId: project.id, assets: project.assets || [] }, dir);
  const saved = { ...project, assets: project.assets?.map(asset => ({ ...asset, file: join(dir, asset.path) })) };
  await writeFile(join(dir, 'app.contract'), project.contract);
  await writeFile(join(dir, 'app.ts'), project.typescript);
  await writeFile(join(dir, 'app.test.contract'), project.tests);
  await atomicJSON(join(dir, 'project.json'), saved);
}
export async function selectedProject(): Promise<string | null> {
  try { return JSON.parse(await readFile(join(DATA, 'selection.json'), 'utf8')).id; }
  catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function selectProject(id: string) { await atomicJSON(join(DATA, 'selection.json'), { id: projectId(id) }); }

export function parseArtifact(raw: string): Artifact {
  const value = JSON.parse(raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim());
  for (const key of ['name', 'contract', 'typescript', 'tests']) {
    if (typeof value[key] !== 'string') throw new Error(`Generation is missing string field ${key}`);
    if (value[key].length > 200_000) throw new Error(`Generated ${key} is too large`);
  }
  if (!value.name.trim() || !value.contract.trim()) throw new Error('Generated name and contract must not be empty');
  return { name: value.name, contract: value.contract, typescript: value.typescript, tests: value.tests };
}
