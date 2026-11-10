import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dir, '..');
export const DATA = process.env.EXACT_CREATE_HOME || join(ROOT, '.exact-create');
export type Artifact = { name: string; contract: string; typescript: string; tests: string };
export type Metadata = { id: string; name: string; description: string };
export type Project = Artifact & { id: string; description?: string; demo?: boolean; prompt: string; provider: string; createdAt: string; updatedAt: string };

export async function seedDemos(destination = DATA) {
  const projects = join(destination, 'projects');
  await mkdir(projects, { recursive: true });
  for (const id of ['pedometer', 'water', 'hydration']) {
    const source = join(ROOT, 'demos', id);
    const [metadata, contract, typescript, tests] = await Promise.all([
      readFile(join(source, 'demo.json'), 'utf8').then(JSON.parse),
      readFile(join(source, 'app.contract'), 'utf8'),
      readFile(join(source, 'app.ts'), 'utf8'),
      readFile(join(source, 'app.test.contract'), 'utf8'),
    ]);
    const dir = join(projects, id);
    try { await mkdir(dir); }
    catch (error: any) { if (error.code === 'EEXIST') continue; throw error; }
    await Promise.all([
      writeFile(join(dir, 'app.contract'), contract),
      writeFile(join(dir, 'app.ts'), typescript),
      writeFile(join(dir, 'app.test.contract'), tests),
    ]);
    await atomicJSON(join(dir, 'project.json'), { ...metadata, id, demo: true, contract, typescript, tests });
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
  return JSON.parse(await readFile(join(DATA, 'projects', projectId(id), 'project.json'), 'utf8'));
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
  await writeFile(join(dir, 'app.contract'), project.contract);
  await writeFile(join(dir, 'app.ts'), project.typescript);
  await writeFile(join(dir, 'app.test.contract'), project.tests);
  await atomicJSON(join(dir, 'project.json'), project);
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
