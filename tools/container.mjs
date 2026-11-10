import { configureOpenRouterEnvironment } from '../src/credentials.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, cpSync, symlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

configureOpenRouterEnvironment();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = resolve(ROOT, 'container');
const STATE = resolve(ROOT, '.exact-create');
export const BUN = process.env.BUN || (existsSync(resolve(homedir(), '.bun-1.4.2/bin/bun')) ? resolve(homedir(), '.bun-1.4.2/bin/bun') : 'bun');
export const APP_ID = 'com.exactcreate.demo';
export const GRANTS = 'fs.read app:/data\nfs.write app:/data\ndevice.health-read purpose.health\nnet.fetch https://openrouter.ai';
const env = () => ({ ...process.env, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || '4', BUN, PATH: `${dirname(BUN)}:${process.env.PATH}`, EXACT2: resolve(ROOT, 'exact') });
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const record = (name, value) => { mkdirSync(STATE, { recursive: true }); writeFileSync(resolve(STATE, name), JSON.stringify(value, null, 2) + '\n'); };
function ensureContainerSources() {
  for (const name of ['app.contract', 'app.ts', 'app.test.contract']) {
    const destination = resolve(APP, name);
    if (!existsSync(destination)) cpSync(resolve(ROOT, 'demos/pedometer', name), destination);
  }
  const contract = resolve(APP, 'app.contract');
  const source = readFileSync(contract, 'utf8');
  const fixed = containerContract(source);
  if (fixed !== source) writeFileSync(contract, fixed);
}
const defaultModule = `export const grants = ${JSON.stringify(GRANTS)};\nexport const answer = (source: string): never => { throw new Error('Unknown source: ' + source); };\n`;
const grantLiteral = /export\s+const\s+grants\s*=\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/;

export function containerContract(source) {
  // Exact links native packages named by the Contract import graph. Keep
  // Health reachable even when the first selected app uses no health source.
  if (/\bfrom\s+["']@exact\/health["']/.test(source)) return source;
  return 'use healthStatus as exactCreateHealthStatus from "@exact/health"\n\n' + source;
}

export function copyRuntimeHelpers(destination) {
  const helper = resolve(ROOT, 'src/runtime/muse.ts');
  if (existsSync(helper)) cpSync(helper, resolve(destination, 'muse.ts'));
}

export function materializeProjectAssets({ projectId, assets = [] }, destination) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectId)) throw new Error('Invalid asset project ID.');
  if (!Array.isArray(assets)) throw new Error('Project assets must be an array.');
  const seen = new Set();
  let assetBytes = 0;
  const prepared = assets.map(asset => {
    const prefix = `assets/generated/${projectId}/`;
    if (typeof asset.path !== 'string' || !asset.path.startsWith(prefix)
      || !/^[a-z0-9][a-z0-9-]*\.(png|jpg|webp)$/.test(asset.path.slice(prefix.length))) {
      throw new Error(`Generated image paths must be PNG, JPEG or WebP files under ${prefix}.`);
    }
    if (seen.has(asset.path)) throw new Error(`Duplicate generated image: ${asset.path}`);
    seen.add(asset.path);
    const bytes = readFileSync(asset.file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const extension = asset.path.split('.').at(-1);
    if (asset.sha256 !== sha256 || !asset.path.endsWith(`-${sha256}.${extension}`)) {
      throw new Error(`Generated image content does not match its hash or immutable path: ${asset.path}`);
    }
    const png = bytes.length >= 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      && bytes.subarray(12, 16).toString() === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
    const jpeg = bytes.length >= 4 && bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
    const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!({ png, jpg: jpeg, webp })[extension]) throw new Error(`Generated image bytes do not match ${extension}: ${asset.path}`);
    assetBytes += bytes.length;
    if (assetBytes > 64 * 1024 * 1024) throw new Error('Generated images exceed the 64 MiB preview asset budget.');
    return { path: asset.path, bytes };
  });
  // Validate the complete set before publishing any bytes. Hash-named files are
  // immutable, so an earlier generation can keep using its image cache.
  for (const { path, bytes } of prepared) {
    const target = resolve(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target) || !readFileSync(target).equals(bytes)) writeFileSync(target, bytes);
  }
  return { assetsStaged: prepared.length, assetBytes };
}
export function normalizeModule(source) {
  source ||= defaultModule;
  const literal = grantLiteral.exec(source);
  const grants = literal?.[2].replace(/\\([nrt\\'"`])/g, (_, character) => ({ n: '\n', r: '\r', t: '\t' }[character] ?? character));
  if (![GRANTS, 'fs.read app:/data\nfs.write app:/data\ndevice.health-read purpose.health\nnet.fetch https://ember-create-gateway.vercel.app', 'fs.read app:/data\nfs.write app:/data\ndevice.health-read purpose.health', 'fs.read app:/data\nfs.write app:/data'].includes(grants)) throw new Error(`The preview requires a literal grants export equal to ${JSON.stringify(GRANTS)}.`);
  source = source.replace(literal[0], `export const grants = ${JSON.stringify(GRANTS)}`);
  source = source.replace(/^const __preview_MUSE_(?:GATEWAY_URL|CLIENT_TOKEN) = import\.meta\.env\.MUSE_(?:GATEWAY_URL|CLIENT_TOKEN);\r?\n/gm, '');
  if (/from\s+['"]\.\/muse(?:\.ts)?['"]/.test(source) && !/\bconfigureMuse\b/.test(source)) {
    source = `import { configureMuse as __configureMuse } from './muse';\nconst __museKey = import.meta.env.OPENROUTER_API_KEY ?? '';\n__configureMuse(__museKey);\n` + source;
  }
  if (!source.includes('import.meta.env.OPENROUTER_API_KEY')) source += '\nconst __preview_OPENROUTER_API_KEY = import.meta.env.OPENROUTER_API_KEY;\n';
  return source;
}

function run(args, cwd = APP, options = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(args[0], args.slice(1), { cwd, env: env(), ...options });
    let output = '';
    child.stdout?.on('data', b => { output += b; });
    child.stderr?.on('data', b => { output += b; });
    child.on('error', fail);
    child.on('close', code => code === 0 ? ok(output) : fail(new Error(output || `${args[0]} exited ${code}`)));
  });
}

export async function validateProject({ projectId, contract, typescript, tests = '', assets = [] }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectId)) throw new Error('Project ID must contain lowercase letters, digits and hyphens.');
  if (typeof contract !== 'string' || !contract.trim()) throw new Error('A non-empty contract is required.');
  contract = containerContract(contract);
  typescript = normalizeModule(typescript);
  if (typescript) {
    const literal = grantLiteral.exec(typescript);
    const paths = [...typescript.replace(literal[0], '').matchAll(/app:\/data[^'"`\s)]*/g)].map(match => match[0]);
    for (const path of paths) {
      if (!path.startsWith(`app:/data/${projectId}-`) || path.includes('..')) throw new Error(`Storage paths must start with app:/data/${projectId}- (found ${path}).`);
    }
    if (/\bappId\b/.test(typescript) && !typescript.includes(APP_ID)) throw new Error(`The preview appId must remain ${APP_ID}.`);
  }
  const dir = resolve(STATE, 'validation', projectId);
  mkdirSync(dir, { recursive: true });
  const paths = new Set(assets.map(asset => asset.path));
  for (const match of `${contract}\n${typescript || ''}`.matchAll(/["'](assets\/generated\/[^"']+)["']/g)) {
    if (!paths.has(match[1])) throw new Error(`Generated image is missing from this project: ${match[1]}`);
  }
  const assetStatus = materializeProjectAssets({ projectId, assets }, dir);
  copyRuntimeHelpers(dir);
  if (!existsSync(resolve(dir, 'node_modules'))) symlinkSync(resolve(APP, 'node_modules'), resolve(dir, 'node_modules'), 'dir');
  cpSync(resolve(APP, 'package.json'), resolve(dir, 'package.json'));
  cpSync(resolve(APP, 'strings'), resolve(dir, 'strings'), { recursive: true });
  mkdirSync(resolve(dir, 'assets'), { recursive: true });
  cpSync(resolve(APP, 'assets/app-icon.png'), resolve(dir, 'assets/app-icon.png'));
  cpSync(resolve(APP, 'exact.mjs'), resolve(dir, 'exact.mjs'));
  const manifest = read(resolve(APP, 'app.json'));
  manifest.$schema = resolve(ROOT, 'exact/scripts/app.schema.json');
  writeFileSync(resolve(dir, 'app.json'), JSON.stringify(manifest));
  writeFileSync(resolve(dir, 'app.contract'), contract);
  writeFileSync(resolve(dir, 'app.ts'), typescript || defaultModule);
  writeFileSync(resolve(dir, 'app.test.contract'), tests);
  const output = await run([BUN, 'exact.mjs', 'contract', 'build', 'app.contract', '--json', '--errors-only'], dir);
  return { ok: true, output, ...assetStatus };
}

async function serverReady(server) {
  const until = Date.now() + 600_000;
  while (Date.now() < until) {
    try { process.kill(server.pid, 0); }
    catch { throw new Error(`Preview server stopped. Read ${server.log}`); }
    try {
      const response = await fetch(`${server.url}/exact.json`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const envelope = await response.json();
        if (envelope.plan) return server;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Preview server did not become ready. Read ${server.log}`);
}

export async function startContainer({ port = 8791 } = {}) {
  ensureContainerSources();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  const url = `http://127.0.0.1:${port}`;
  let previous;
  try {
    previous = read(resolve(STATE, 'container-server.json'));
    process.kill(previous.pid, 0);
  } catch { previous = null; }
  if (previous) {
    if (previous.url !== url) throw new Error(`Container server already runs at ${previous.url}`);
    return serverReady(previous);
  }
  mkdirSync(STATE, { recursive: true });
  const log = resolve(STATE, 'container-server.log');
  const fd = openSync(log, 'a');
  const child = spawn(BUN, ['exact.mjs', 'web', '--port', String(port)], {
    cwd: APP, env: { ...env(), EXACT_WEB_DIST: resolve(STATE, 'container-web') }, detached: true, stdio: ['ignore', fd, fd],
  });
  child.unref(); closeSync(fd);
  const result = { pid: child.pid, url, port, log };
  record('container-server.json', result);
  return serverReady(result);
}

export async function launchContainer({ sim, port = 8791, rebuild = false } = {}) {
  const server = await startContainer({ port });
  let previous;
  try { previous = read(resolve(STATE, 'container-launch.json')); } catch {}
  const selectedSim = sim || previous?.sim;
  if (!rebuild && previous && selectedSim) {
    const installed = spawnSync('xcrun', ['simctl', 'get_app_container', selectedSim, APP_ID, 'app'], { encoding: 'utf8' });
    if (installed.status === 0) {
      record('container-launch.json', { ...previous, url: server.url, sim: selectedSim, appId: APP_ID, at: new Date().toISOString() });
      await restartInstalled();
      return { ...server, appId: APP_ID, reused: true, nativeRebuild: false };
    }
  }
  const args = [BUN, 'exact.mjs', 'ios', '--run', '--url', server.url];
  if (selectedSim) args.push('--sim', selectedSim);
  const output = await run(args);
  record('container-launch.json', { url: server.url, sim: selectedSim || null, appId: APP_ID, at: new Date().toISOString() });
  return { ...server, output, appId: APP_ID };
}

async function restartInstalled() {
  let launch;
  try { launch = read(resolve(STATE, 'container-launch.json')); } catch { return false; }
  const target = launch.sim || 'booted';
  spawnSync('xcrun', ['simctl', 'terminate', target, APP_ID], { encoding: 'utf8' });
  await run(['xcrun', 'simctl', 'launch', '--terminate-running-process', target, APP_ID], APP,
    { env: { ...env(), SIMCTL_CHILD_EXACT_DEV_PLAN: launch.url } });
  return true;
}

let staging = Promise.resolve();
export function stageProject(project) {
  const operation = staging.then(async () => {
    await validateProject(project);
    let previous; try { previous = read(resolve(STATE, 'active-project.json')); } catch {}
    const module = normalizeModule(project.typescript);
    const assetStatus = materializeProjectAssets(project, APP);
    copyRuntimeHelpers(APP);
    // Exact publishes a complete baked generation; a rejected intermediate bake leaves the old one live.
    writeFileSync(resolve(APP, 'app.ts'), module);
    writeFileSync(resolve(APP, 'app.test.contract'), project.tests || '');
    writeFileSync(resolve(APP, 'app.contract'), containerContract(project.contract));
    record('active-project.json', { projectId: project.projectId, selectedAt: new Date().toISOString() });
    const restarted = previous?.projectId !== project.projectId ? await restartInstalled() : false;
    return { projectId: project.projectId, staged: true, restarted, nativeRebuild: false, ...assetStatus };
  });
  staging = operation.catch(() => {});
  return operation;
}

if (import.meta.main) {
  const [verb, ...args] = process.argv.slice(2);
  const result = verb === 'start' ? await startContainer()
    : verb === 'launch' ? await launchContainer({ sim: args[0] })
    : verb === 'stage' ? await stageProject({ projectId: args[0], contract: readFileSync(args[1], 'utf8'), typescript: args[2] ? readFileSync(args[2], 'utf8') : undefined })
    : (() => { throw new Error('Usage: bun tools/container.mjs start|launch [sim]|stage <id> <contract> [typescript]'); })();
  console.log(JSON.stringify(result, null, 2));
}
