import { expect, test } from 'bun:test';
import { decodeBundledKey, resolveOpenRouterKey, configureOpenRouterEnvironment } from '../src/credentials.mjs';

test('explicit keys override the bundled default without reading it', () => {
  expect(resolveOpenRouterKey({ OPENROUTER_API_KEY: '  user-key  ' }, () => { throw new Error('must not read'); })).toBe('user-key');
});
test('missing keys use the demo default and propagate to native build children', () => {
  const env: Record<string, string> = {};
  expect(configureOpenRouterEnvironment(env, () => 'demo-key')).toBe('demo-key');
  expect(env.OPENROUTER_API_KEY).toBe('demo-key');
  env.OPENROUTER_API_KEY = 'override';
  expect(configureOpenRouterEnvironment(env, () => 'demo-key')).toBe('override');
});
test('obfuscated payload decodes and missing source-checkout payloads remain optional', () => {
  const key = Buffer.from('test-key');
  const mask = Buffer.from([12,34,56,78,90,12,34,56]);
  const data = Buffer.from(key.map((byte, i) => byte ^ mask[i]));
  expect(decodeBundledKey({ data: data.toString('base64'), mask: mask.toString('base64') })).toBe('test-key');
  expect(decodeBundledKey({ data: 'abcd', mask: '' })).toBe('');
  expect(resolveOpenRouterKey({}, () => '')).toBe('');
});
