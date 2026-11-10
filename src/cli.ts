#!/usr/bin/env bun
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { appendFileSync, mkdirSync } from 'node:fs';
import { DATA, getProject, listProjects, saveProject, selectProject, selectedProject, projectId, makeId, availableId, type Artifact, type Project, type Metadata } from './projects';
import { generateArtifact, generateMetadata, generationPrompt, type Event } from './providers';
import { validateProject, stageProject, startContainer, launchContainer } from '../tools/container.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
let runLog: string | undefined;
let totalCost = 0;
let hasReportedCost = false;
function option(name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at < 0) return;
  if (!argv[at + 1] || argv[at + 1].startsWith('--')) throw new Error(`${name} needs a value`);
  return argv[at + 1];
}
function emit(event: Event) {
  if (runLog) appendFileSync(runLog, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
  const usage = event.usage as { cost?: number } | undefined;
  if (typeof usage?.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0) {
    totalCost += usage.cost;
    hasReportedCost = true;
  }
  console.log(json ? JSON.stringify(event) : event.message);
  if (!json && typeof event.totalCostUsd === 'number') console.log(`OpenRouter cost: $${event.totalCostUsd.toFixed(6)} USD (including naming and repairs)`);
}
function diagnosticText(raw: string): string {
  try {
    const entries = JSON.parse(raw);
    if (Array.isArray(entries)) return entries.map(d => `${d.file || 'Contract'}:${d.line || '?'} — ${d.message}`).join('\n');
  } catch {}
  return raw;
}
function fixture(id: string, prompt: string): Artifact {
  const name = prompt || 'Counter';
  const component = 'App' + id.replace(/[^a-z0-9]/gi, '');
  return {
    name,
    contract: `component ${component}\n  state count = 0\n  action increment\n    count = count + 1\n  action reset\n    count = 0\n  view\n    column padding=24 gap=16 height="100%"\n      text ${JSON.stringify(name)} font-size=28 font-weight=700 testId="title"\n      text \`Count: \${count}\` font-size=36 testId="count"\n      button press=increment buttonStyle="filled" testId="increment"\n        text "Add one"\n      button press=reset testId="reset"\n        text "Reset"\n`.replaceAll('\\`', '`'),
    typescript: '',
    tests: 'test "increments and resets"\n  tap "increment"\n  expect text "count" == "Count: 1"\n  tap "reset"\n  expect text "count" == "Count: 0"\n',
  };
}
async function activate(project: Project) {
  emit({ type: 'status', message: `Validating and staging ${project.name}` });
  const result = await stageProject({ projectId: project.id, contract: project.contract, typescript: project.typescript, tests: project.tests });
  await selectProject(project.id);
  await startContainer();
  emit({ type: 'selected', message: `Selected ${project.name}; staged for the container development stream`, id: project.id, ...result });
}
async function generate() {
  const request = argv[1];
  if (!request || request.startsWith('--')) throw new Error('Usage: generate "Describe your app" [--id project-id] [--image file] [--provider codex|openrouter]');
  const manualId = option('--id') ? projectId(option('--id')!) : undefined;
  mkdirSync(join(DATA, 'runs'), { recursive: true });
  runLog = join(DATA, 'runs', `${manualId || 'new'}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jsonl`);
  const provider = option('--provider') || (process.env.OPENROUTER_API_KEY ? 'openrouter' : 'codex');
  const image = option('--image') ? resolve(option('--image')!) : undefined;
  if (image) await readFile(image); // Fail before starting a paid/model call.
  const started = performance.now();
  let metadata: Metadata | undefined;
  if (!manualId && !argv.includes('--fixture') && process.env.OPENROUTER_API_KEY) {
    emit({ type: 'status', message: 'Muse Ember is naming your app' });
    metadata = await generateMetadata(request, image, emit);
    metadata.id = availableId(metadata.id, (await listProjects()).map(project => project.id));
    emit({ type: 'metadata', message: `${metadata.name} — ${metadata.description}`, ...metadata });
  }
  const id = manualId || metadata?.id || makeId(request);
  let previous: Project | undefined;
  try { previous = await getProject(id); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  let artifact: Artifact | undefined = previous;
  let diagnostics: string | undefined;
  const attempts = argv.includes('--fixture') ? 1 : 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    emit({ type: 'status', message: `${diagnostics ? 'Repairing' : 'Generating'} ${id} with ${argv.includes('--fixture') ? 'fixture' : provider === 'openrouter' ? 'Muse Ember' : 'Codex'} (${attempt}/${attempts})`, id, attempt });
    artifact = argv.includes('--fixture') ? fixture(id, request) : await generateArtifact({ provider, model: option('--model'), image, prompt: await generationPrompt(id, request, artifact, diagnostics, metadata), emit });
    emit({ type: 'status', message: 'Checking the generated Contract and TypeScript' });
    try {
      await validateProject({ projectId: id, contract: artifact.contract, typescript: artifact.typescript });
      diagnostics = undefined;
      break;
    } catch (e: any) {
      diagnostics = e.message;
      emit({ type: 'diagnostics', message: diagnosticText(diagnostics), diagnostics, attempt });
    }
  }
  if (!artifact || diagnostics) throw new Error(`Generation failed validation after ${attempts} attempt(s). The active app was left unchanged.\n${diagnosticText(diagnostics || '')}`);
  const project: Project = { ...artifact, name: metadata?.name || artifact.name, description: metadata?.description || previous?.description, demo: previous?.demo, id, prompt: request, provider: argv.includes('--fixture') ? 'fixture' : provider, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  await saveProject(project);
  if (!argv.includes('--no-select')) await activate(project);
  emit({ type: 'result', message: `Generated ${project.name}`, id, name: project.name, description: project.description, directory: join(DATA, 'projects', id), elapsedMs: Math.round(performance.now() - started), selected: !argv.includes('--no-select'), runLog, ...(hasReportedCost ? { totalCostUsd: totalCost } : {}) });
}

try {
  switch (argv[0]) {
    case 'generate': await generate(); break;
    case 'list': {
      const projects = (await listProjects()).map(({ id, name, description, demo, prompt, provider, updatedAt }) => ({ id, name, description, demo: Boolean(demo), prompt, provider, updatedAt }));
      const selectedId = await selectedProject();
      emit({ type: 'projects', message: projects.length ? projects.map(p => `${p.id === selectedId ? '*' : ' '} ${p.id}  ${p.name}${p.demo ? ' [Demo]' : ''}`).join('\n') : 'No projects yet. Generate one to begin.', projects, selectedId });
      break;
    }
    case 'select': case 'open': await activate(await getProject(projectId(argv[1] || ''))); break;
    case 'install': {
      const project = await getProject(projectId(argv[1] || ''));
      await activate(project);
      const result = await launchContainer({ sim: option('--sim') });
      emit({ type: 'result', message: `Opened ${project.name} in the iOS container`, id: project.id, ...result });
      break;
    }
    case 'serve': {
      const result = await startContainer({ port: Number(option('--port') || 8791) });
      emit({ type: 'result', message: `Container development server: ${result.url}`, ...result });
      break;
    }
    case 'ios': {
      emit({ type: 'status', message: 'Building and launching the iOS container (first run can take several minutes)' });
      const result = await launchContainer({ sim: option('--sim'), port: Number(option('--port') || 8791) });
      emit({ type: 'result', message: 'iOS container launched', ...result });
      break;
    }
    default: emit({ type: 'help', message: 'Exact Create\n  generate "Describe an app" [--id id] [--image path] [--provider codex|openrouter] [--model model]\n  list\n  select <id>\n  serve [--port 8791]\n  ios [--sim simulator-id]\n\nAdd --json for JSONL events. --fixture generates a deterministic test counter. --no-select validates and saves without changing the container.' });
  }
} catch (error: any) {
  emit({ type: 'error', message: error.message || String(error), ...(hasReportedCost ? { totalCostUsd: totalCost } : {}) });
  process.exitCode = 1;
}
