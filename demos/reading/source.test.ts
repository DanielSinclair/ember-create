import { afterAll, beforeEach, expect, test } from 'bun:test';

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const previousKey = process.env.OPENROUTER_API_KEY;
process.env.OPENROUTER_API_KEY = 'bookshelf-test-key';
const originalFetch = globalThis.fetch;
let files: Map<string, Uint8Array>;
let requests: Record<string, unknown>[];
let response: unknown;
globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
  requests.push(JSON.parse(options.body as string));
  return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;
// The build copies this same helper beside app.ts. Test that actual pair without
// adding generated helper files to the demo or making real network requests.
const fixture = mkdtempSync(join(tmpdir(), 'reading-source-test-'));
copyFileSync(new URL('./app.ts', import.meta.url), join(fixture, 'app.ts'));
copyFileSync(new URL('../../src/runtime/muse.ts', import.meta.url), join(fixture, 'muse.ts'));
const { answer } = await import(join(fixture, 'app.ts'));
const textReply = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR5mP8/x8AAusB9Wl6cS8AAAAASUVORK5CYII=';
const imageReply = (base64: string) => ({ data: [{ b64_json: base64 }] });
const storage = { fs: {
  readFile: async (path: string) => {
    if (!files.has(path)) throw Object.assign(new Error('Missing file'), { code: 'ENOENT' });
    return files.get(path)!;
  },
  atomicWriteFile: async (path: string, bytes: Uint8Array) => { files.set(path, bytes); },
} };
const call = (name: string, args: string[] = []) => answer(name as never, args as never, {} as never, storage as never, {} as never);
beforeEach(() => { files = new Map(); requests = []; response = {}; });
afterAll(() => {
  globalThis.fetch = originalFetch;
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey;
  rmSync(fixture, { recursive: true, force: true });
});

test('book clues return a possible match with uncertainty', async () => {
  response = textReply({ candidate: { title: 'The Little Prince', author: 'Antoine de Saint-Exupéry', description: 'A visitor from a tiny planet.', coverDescription: 'A small prince on a planet under stars.' }, uncertainty: 'Cover editions vary.' });
  const match = await call('searchBook', ['The Little Prince', 'tiny planets']);
  expect(match).toMatchObject({ ok: true, title: 'The Little Prince', uncertainty: 'Cover editions vary.' });
  expect(requests[0]).toMatchObject({ model: 'meta/muse-spark-1.3' });
  expect(JSON.stringify(requests[0].messages)).toContain('tiny planets');
});

test('adding a cover persists the book, prevents another paid duplicate, and can remove it', async () => {
  response = imageReply(png);
  expect(await call('loadBooks')).toEqual([]);
  const args = ['The Little Prince', 'Antoine de Saint-Exupéry', 'A visitor from a tiny planet.', 'Stars and a small planet'];
  expect(await call('addBook', args)).toEqual({ ok: true, error: '' });
  const books = await call('loadBooks') as Array<{ id: string; title: string }>;
  expect(books[0].title).toBe('The Little Prince');
  expect(await call('addBook', args)).toMatchObject({ ok: false });
  expect(requests).toHaveLength(1);
  expect(await call('removeBook', [books[0].id])).toEqual({ ok: true, error: '' });
  expect(await call('loadBooks')).toEqual([]);
});

test('uncertain lookup and malformed covers do not create shelf entries', async () => {
  response = textReply({ candidate: null, uncertainty: 'More clues would help.' });
  expect(await call('searchBook', ['', 'blue cover'])).toMatchObject({ ok: false, error: 'More clues would help.' });
  response = imageReply('not-an-image');
  expect(await call('addBook', ['Book', 'Author', 'Story', 'Cover'])).toMatchObject({ ok: false });
  expect(await call('loadBooks')).toEqual([]);
});

test('corrupt saved data is reported and never overwritten', async () => {
  const corrupt = new TextEncoder().encode('{broken');
  files.set('app:/data/reading-books.json', corrupt);
  expect(await call('addBook', ['Book', 'Author', 'Story', 'Cover'])).toMatchObject({ ok: false });
  expect(requests).toHaveLength(0);
  expect(files.get('app:/data/reading-books.json')).toEqual(corrupt);
});
