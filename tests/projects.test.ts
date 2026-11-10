import { test, expect, afterAll } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'exact-create-test-'));
process.env.EXACT_CREATE_HOME = directory;
const { parseArtifact, parseMetadata, availableId, projectId, seedDemos, saveProject, getProject, listProjects, selectProject, selectedProject } = await import('../src/projects');
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

test('rejects malformed generated artifacts and path traversal IDs', () => {
  expect(() => parseArtifact('{"name":"Hello","contract":"component Hello"}')).toThrow('typescript');
  expect(() => parseArtifact('{"name":"Hello","contract":"","typescript":"","tests":""}')).toThrow('must not be empty');
  for (const id of ['../escape', '/tmp/a', 'a/b', 'UPPER', '', 'a'.repeat(65)]) expect(() => projectId(id)).toThrow();
});

test('validates generated project metadata and avoids overwriting an existing name', () => {
  const metadata = parseMetadata('{"id":"daily-stride","name":"Daily Stride","description":"Shows today’s steps from Apple Health."}');
  expect(metadata.name).toBe('Daily Stride');
  expect(availableId(metadata.id, ['daily-stride', 'daily-stride-2'])).toBe('daily-stride-3');
  expect(availableId('a'.repeat(64), ['a'.repeat(64)]).length).toBe(64);
  expect(() => parseMetadata('{"id":"../escape","name":"Bad","description":"Bad path"}')).toThrow();
  expect(() => parseMetadata('{"id":"valid","name":"","description":"Empty name"}')).toThrow('name');
});

test('direct demo lookup works without first listing projects', async () => {
  const project = await getProject('pedometer');
  expect(project.demo).toBe(true);
  expect(project.name).toBe('Stride');
});

test('saves distinct projects and changes selection without changing their source', async () => {
  const base = { prompt: 'counter', provider: 'fixture', createdAt: '2026-01-01', updatedAt: '2026-01-01', typescript: '', tests: '' };
  await saveProject({ ...base, id: 'alpha', name: 'Alpha', contract: 'component Alpha' });
  await saveProject({ ...base, id: 'beta', name: 'Beta', contract: 'component Beta' });
  expect((await listProjects()).filter(project => !project.demo).length).toBe(2);
  await selectProject('alpha');
  expect(await selectedProject()).toBe('alpha');
  await selectProject('beta');
  expect(await selectedProject()).toBe('beta');
  expect((await getProject('alpha')).contract).toBe('component Alpha');
  expect((await getProject('beta')).contract).toBe('component Beta');
});

test('fresh registries receive bundled demos and existing projects are never overwritten', async () => {
  const fresh = await mkdtemp(join(tmpdir(), 'exact-create-demos-'));
  try {
    await mkdir(join(fresh, 'projects', 'water'), { recursive: true });
    await writeFile(join(fresh, 'projects', 'water', 'project.json'), '{"name":"My Water"}');
    await writeFile(join(fresh, 'projects', 'water', 'app.contract'), 'my original source');
    await seedDemos(fresh);
    const pedometer = JSON.parse(await readFile(join(fresh, 'projects', 'pedometer', 'project.json'), 'utf8'));
    expect(pedometer.demo).toBe(true);
    expect(pedometer.contract).toContain('from "@exact/health"');
    expect(await readFile(join(fresh, 'projects', 'pedometer', 'app.contract'), 'utf8')).toBe(pedometer.contract);
    expect(await readFile(join(fresh, 'projects', 'water', 'project.json'), 'utf8')).toBe('{"name":"My Water"}');
    expect(await readFile(join(fresh, 'projects', 'water', 'app.contract'), 'utf8')).toBe('my original source');
    await seedDemos(fresh);
    expect(JSON.parse(await readFile(join(fresh, 'projects', 'hydration', 'project.json'), 'utf8')).demo).toBe(true);
    const focus = JSON.parse(await readFile(join(fresh, 'projects', 'focus', 'project.json'), 'utf8'));
    expect(focus.demo).toBe(true);
    expect(focus.contract).toContain('minutes == 5 ?');
    expect(focus.tests).toContain('restarting after completion');
  } finally { await rm(fresh, { recursive: true, force: true }); }
});
