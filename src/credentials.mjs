import { readFileSync } from 'node:fs';

export function decodeBundledKey(payload) {
  if (!payload || typeof payload.data !== 'string' || typeof payload.mask !== 'string') return '';
  const data = Buffer.from(payload.data, 'base64');
  const mask = Buffer.from(payload.mask, 'base64');
  if (!mask.length || data.length !== mask.length) return '';
  return Buffer.from(data.map((byte, i) => byte ^ mask[i])).toString('utf8');
}
function bundledKey() {
  try { return decodeBundledKey(JSON.parse(readFileSync(new URL('./embedded-key.json', import.meta.url), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('Bundled OpenRouter configuration is invalid.'); }
}
export function resolveOpenRouterKey(environment = process.env, fallback = bundledKey) {
  return environment.OPENROUTER_API_KEY?.trim() || fallback();
}
export function configureOpenRouterEnvironment(environment = process.env, fallback = bundledKey) {
  const key = resolveOpenRouterKey(environment, fallback);
  if (key) environment.OPENROUTER_API_KEY = key;
  return key;
}
