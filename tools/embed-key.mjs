// Release-time obfuscation only: both pieces ship, so the key is recoverable.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error('Set OPENROUTER_API_KEY before preparing the bundled credential.');
const bytes = Buffer.from(key);
const mask = randomBytes(bytes.length);
const data = Buffer.from(bytes.map((byte, i) => byte ^ mask[i]));
writeFileSync(new URL('../src/embedded-key.json', import.meta.url), JSON.stringify({ data: data.toString('base64'), mask: mask.toString('base64') }) + '\n', { mode: 0o600 });
console.log('Prepared obfuscated default credential; value not printed.');
