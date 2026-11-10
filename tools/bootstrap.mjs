import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log(manifest.version); process.exit(0); }
if (args[0] === '--help' || args[0] === '-h') {
  console.log('Exact Create\n  No arguments: open the TUI\n  setup: prepare pinned Exact dependencies\n  generate "Describe an app" | list | open <id> | ios\n\nRequires macOS, Xcode, Bun 1.4.2 and Rust 1.97.0.\nFirst launch prepares a persistent runtime; later launches reuse its builds.\nSet OPENROUTER_API_KEY in your environment. No credentials are included.');
  process.exit(0);
}
if (process.platform !== 'darwin') throw new Error('Exact Create currently requires macOS for its iOS simulator.');
if (Bun.version !== '1.4.2') throw new Error('Exact Create needs Bun 1.4.2. Set BUN to that executable and retry.');

const entries = ['package.json', ...manifest.files].sort();
const digest = createHash('sha256');
async function fingerprint(relative) {
  const file = join(source, relative);
  if ((await stat(file)).isDirectory()) {
    for (const name of (await readdir(file)).sort()) await fingerprint(join(relative, name));
  } else {
    digest.update(relative); digest.update(await readFile(file));
  }
}
for (const entry of entries) await fingerprint(entry);
const base = process.env.EXACT_CREATE_RUNTIME_HOME || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'exact-create');
const runtimes = join(base, 'runtimes');
await mkdir(runtimes, { recursive: true });
const runtime = join(runtimes, `${manifest.version}-${digest.digest('hex').slice(0, 16)}`);
if (!existsSync(runtime)) {
  const temp = await mkdtemp(join(runtimes, '.prepare-'));
  try {
    for (const entry of entries) {
      await mkdir(dirname(join(temp, entry)), { recursive: true });
      await cp(join(source, entry), join(temp, entry), { recursive: true });
    }
    await mkdir(join(temp, '.exact-create'));
    for (const name of ['projects', 'runs']) {
      const shared = join(base, name);
      await mkdir(shared, { recursive: true });
      await symlink(shared, join(temp, '.exact-create', name), 'dir');
    }
    try { await rename(temp, runtime); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
  } finally { await rm(temp, { recursive: true, force: true }); }
}
const env = { ...process.env, BUN: process.execPath, EXACT_CREATE_BOOTSTRAPPED: '1', EXACT_CREATE_NO_LINK: '1', EXACT_CREATE_RUNTIME_ONLY: '1' };
const ready = join(runtime, '.exact-create', 'setup-complete');
if (!existsSync(ready) || args[0] === 'setup') {
  console.error('Preparing Exact Create. The first setup downloads pinned Exact sources and dependencies.');
  const setup = Bun.spawn(['sh', join(runtime, 'tools/setup.sh')], { cwd: runtime, env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  const code = await setup.exited;
  if (code !== 0) process.exit(code);
  await writeFile(ready, manifest.version + '\n');
  if (args[0] === 'setup') process.exit(0);
}
const child = Bun.spawn(['sh', join(runtime, 'bin/exact-create'), ...args], { cwd: runtime, env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
process.exit(await child.exited);
