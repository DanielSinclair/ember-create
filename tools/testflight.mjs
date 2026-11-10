import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, symlinkSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUN, APP_ID, copyRuntimeHelpers, materializeProjectAssets, normalizeModule, validateProject } from './container.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASC = process.env.ASC_BINARY || (existsSync('/opt/homebrew/bin/asc') ? '/opt/homebrew/bin/asc' : 'asc');
const noop = () => {};
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const environment = extra => ({ ...process.env, BUN, EXACT2: resolve(ROOT, 'exact'), CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || '4', PATH: `${dirname(BUN)}:${process.env.PATH}`, ...extra });

function command(executable, args, { cwd = ROOT, env = environment(), input, emit = noop } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept(output) : reject(new Error(error.trim() || output.trim() || `${executable} exited ${code}`)));
    child.stdin.end(input);
    const heartbeat = setInterval(() => emit({ type: 'status', message: 'TestFlight task is still running' }), 15000);
    child.once('close', () => clearInterval(heartbeat));
    child.once('error', () => clearInterval(heartbeat));
  });
}
const asc = async args => JSON.parse(await command(ASC, [...args, '--output', 'json']));

export function releaseIdentity(projectId, container = false) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(projectId)) throw new Error('Invalid release project ID.');
  return container ? 'com.exactcreate.gallery' : `com.exactcreate.generated.${projectId}`;
}
export function releaseManifest(base, { id, name, container = false }) {
  const bundleId = releaseIdentity(id, container);
  const manifest = structuredClone(base);
  manifest.$schema = resolve(ROOT, 'exact/scripts/app.schema.json');
  manifest.name = manifest.short_name = name;
  manifest.id = bundleId;
  manifest.app = { ...manifest.app, id: bundleId, name };
  manifest.deploy = { store: { web: '0', ios: '0' } };
  delete manifest.host.ios.localNetworking;
  return manifest;
}

export function releaseLauncher(template, directory) {
  if (!template.includes('name: "container"')) throw new Error('The container launcher is missing its expected app name.');
  // Exact generates its native Cargo crate names from the app directory name.
  return template.replace('name: "container"', `name: ${JSON.stringify(basename(directory))}`);
}

export async function prepareRelease({ project, sourceDir, container = false, emit = noop }) {
  if (!project?.id || !project?.contract) throw new Error('A saved project is required for TestFlight.');
  emit({ type: 'status', message: `Preparing standalone ${project.name}` });
  if (!sourceDir) await validateProject({ ...project, projectId: project.id });
  const directory = resolve(ROOT, '.exact-create/releases', container ? 'container' : project.id);
  mkdirSync(directory, { recursive: true });
  if (sourceDir) cpSync(resolve(sourceDir), directory, { recursive: true, filter: path => !/(^|\/)(node_modules|\.exact|target)(\/|$)/.test(path) });
  for (const file of ['exact.mjs', 'package.json']) cpSync(resolve(ROOT, 'container', file), resolve(directory, file));
  writeFileSync(resolve(directory, 'exact.mjs'), releaseLauncher(readFileSync(resolve(directory, 'exact.mjs'), 'utf8'), directory));
  if (!existsSync(resolve(directory, 'node_modules'))) symlinkSync(resolve(ROOT, 'container/node_modules'), resolve(directory, 'node_modules'), 'dir');
  cpSync(resolve(ROOT, 'container/strings'), resolve(directory, 'strings'), { recursive: true });
  mkdirSync(resolve(directory, 'assets'), { recursive: true });
  cpSync(resolve(ROOT, 'container/assets/app-icon.png'), resolve(directory, 'assets/app-icon.png'));
  materializeProjectAssets({ projectId: project.id, assets: project.assets || [] }, directory);
  copyRuntimeHelpers(directory);
  const manifest = releaseManifest(readJSON(resolve(ROOT, 'container/app.json')), { ...project, container });
  writeFileSync(resolve(directory, 'app.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(resolve(directory, 'app.contract'), project.contract);
  writeFileSync(resolve(directory, 'app.ts'), normalizeModule(project.typescript).replaceAll(APP_ID, manifest.id));
  writeFileSync(resolve(directory, 'app.test.contract'), project.tests || '');
  await command(BUN, ['exact.mjs', 'contract', 'build', 'app.contract', '--json', '--errors-only'], { cwd: directory });
  return { directory, bundleId: manifest.id, name: project.name, ipa: resolve(directory, 'app.ipa') };
}

export async function testFlightPreflight(release) {
  const blockers = [];
  let app = null, webAuthenticated = false;
  try {
    const result = await asc(['apps', 'list', '--bundle-id', release.bundleId]);
    app = result.data?.find(row => row.attributes?.bundleId === release.bundleId) || null;
  } catch (error) { blockers.push(`App Store Connect authentication: ${error.message}`); }
  if (!app) {
    try { webAuthenticated = JSON.parse(await command(ASC, ['web', 'auth', 'status'])).authenticated === true; } catch {}
    if (!webAuthenticated) blockers.push(`Create ${release.bundleId} in App Store Connect, or sign in with asc web auth login so the app record can be created.`);
  }
  const identities = await command('security', ['find-identity', '-v', '-p', 'codesigning']);
  const distribution = [...identities.matchAll(/([A-F0-9]{40}) "((?:Apple Distribution|iPhone Distribution):[^"]+)"/g)];
  const identity = process.env.EXACT_IDENTITY || (distribution.length === 1 ? distribution[0][1] : null);
  if (!identity || !distribution.some(match => match[1] === identity || match[2] === identity)) blockers.push('Install an Apple Distribution certificate with its private key and set EXACT_IDENTITY to its signing identity SHA-1.');
  const profile = process.env.EXACT_PROFILE;
  if (!profile || !existsSync(profile)) blockers.push(`Set EXACT_PROFILE to an App Store provisioning profile for ${release.bundleId}.`);
  else {
    try {
      const plist = await command('security', ['cms', '-D', '-i', profile]);
      const value = JSON.parse(await command('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist }));
      const identifier = value.Entitlements?.['application-identifier'];
      if (!identifier?.endsWith(`.${release.bundleId}`) || value.Entitlements?.['get-task-allow'] || value.ProvisionedDevices || value.ProvisionsAllDevices || new Date(value.ExpirationDate) <= new Date()) {
        blockers.push(`EXACT_PROFILE must be an unexpired App Store distribution profile for ${release.bundleId}.`);
      }
    } catch (error) { blockers.push(`Cannot inspect EXACT_PROFILE: ${error.message}`); }
  }
  return { ready: blockers.length === 0, blockers, appId: app?.id || null, webAuthenticated, identity, profile };
}

async function publish({ project, sourceDir, container = false, emit = noop, dryRun = false }) {
  const release = await prepareRelease({ project, sourceDir, container, emit });
  emit({ type: 'status', message: 'Checking App Store Connect and distribution signing' });
  const preflight = await testFlightPreflight(release);
  const report = { ...release, ready: preflight.ready, blockers: preflight.blockers, appId: preflight.appId, uploaded: false, available: false };
  writeFileSync(resolve(release.directory, 'preflight.json'), JSON.stringify(report, null, 2) + '\n');
  if (dryRun) return { ...report, dryRun: true };
  if (!preflight.ready) throw new Error(`TestFlight preparation is saved at ${release.directory}. ${preflight.blockers.join(' ')}`);
  if (!preflight.appId) {
    emit({ type: 'status', message: 'Creating the App Store Connect app record' });
    await asc(['web', 'apps', 'create', '--name', release.name, '--bundle-id', release.bundleId, '--sku', release.bundleId, '--platform', 'IOS', '--primary-locale', 'en-US', '--if-exists', 'skip']);
    const listed = await asc(['apps', 'list', '--bundle-id', release.bundleId]);
    preflight.appId = listed.data?.find(row => row.attributes?.bundleId === release.bundleId)?.id;
    if (!preflight.appId) throw new Error('App creation returned without a matching App Store Connect app record.');
  }
  emit({ type: 'status', message: 'Archiving signed standalone iOS app' });
  const version = process.env.EXACT_VERSION || '1.0.0';
  const builds = await asc(['builds', 'list', '--app', preflight.appId, '--version', version, '--processing-state', 'all', '--paginate']);
  const numericBuilds = (builds.data || []).map(row => row.attributes?.version).filter(value => /^\d+$/.test(value)).map(Number);
  const buildNumber = process.env.EXACT_BUILD_NUMBER || String(Math.max(0, ...numericBuilds) + 1);
  await command(BUN, ['exact.mjs', 'ios', '--device', '--archive', release.ipa, '--release'], {
    cwd: release.directory, emit,
    env: environment({ EXACT_IDENTITY: preflight.identity, EXACT_PROFILE: resolve(preflight.profile), EXACT_BUILD_NUMBER: buildNumber, EXACT_VERSION: version }),
  });
  emit({ type: 'status', message: 'Uploading IPA to TestFlight and waiting for Apple processing' });
  const result = JSON.parse(await command(ASC, ['publish', 'testflight', '--app', preflight.appId, '--ipa', release.ipa, '--upload-only', '--wait', '--timeout', '30m', '--output', 'json'], { emit }));
  // No beta group assignment or tester notification is implied by an upload.
  const receipt = { ...report, appId: preflight.appId, uploaded: true, available: false, buildNumber, result };
  writeFileSync(resolve(release.directory, 'upload.json'), JSON.stringify(receipt, null, 2) + '\n');
  emit({ type: 'testflight_uploaded', message: 'Apple accepted and processed the upload; beta tester availability is separate', appId: preflight.appId });
  return receipt;
}
export const publishProject = options => publish(options);
export const publishContainer = options => publish({ ...options, container: true });
