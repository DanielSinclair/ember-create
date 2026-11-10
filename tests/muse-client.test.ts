import { expect, test } from 'bun:test';
import { createMuseClient, saveMuseImage } from '../src/runtime/muse';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cS8AAAAASUVORK5CYII=';

test('generated artwork persists bounded PNGs and cleans the source after success or failure', async () => {
  const path = 'app:/data/reading-cover-test.png';
  const calls: string[] = [];
  let fail = false;
  const saved = { path, type: 'image/png', size: 90, width: 1, height: 1 };
  const storage = { fs: {
    atomicWriteFile: async (file: string, bytes: Uint8Array) => {
      calls.push(`write ${file}`);
      expect(Buffer.from(bytes)).toEqual(Buffer.from(png, 'base64'));
    },
    compressImage: async (from: string, to: string, options: object) => {
      calls.push(`compress ${from} ${to}`);
      expect(options).toEqual({ maxDimension: 1024, maxBytes: 700_000, type: 'image/png' });
      if (fail) throw new Error('Cannot decode image');
      return saved;
    },
    rm: async (file: string) => { calls.push(`remove ${file}`); },
  } };
  expect(await saveMuseImage(`data:image/png;base64,${png}`, path, storage)).toEqual(saved);
  expect(calls).toEqual([`write ${path}.source`, `compress ${path}.source ${path}`, `remove ${path}.source`]);
  fail = true;
  await expect(saveMuseImage(`data:image/png;base64,${png}`, path, storage)).rejects.toThrow('Cannot decode');
  expect(calls.at(-1)).toBe(`remove ${path}.source`);
  await expect(saveMuseImage(`data:image/png;base64,${png}`, 'app:/data/../outside.png', storage)).rejects.toThrow('project-scoped');
});

test('direct client uses fixed OpenRouter endpoints and keeps credentials out of payload and results', async () => {
  const client = createMuseClient({ apiKey: 'test-key', fetcher: (async (url, options) => {
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const payload = JSON.parse(String(options?.body));
    expect(payload.model).toBe('meta/muse-ember');
    expect(String(options?.body)).not.toContain('test-key');
    return Response.json({ choices: [{ message: { content: 'Hello' } }], usage: { cost: 0.002 } });
  }) as typeof fetch });
  expect(await client.museText('Hello')).toEqual({ text: 'Hello', costUsd: 0.002 });
});

test('missing credentials, unsupported models, and oversized prompts fail before spending', async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; throw new Error('unexpected'); }) as typeof fetch;
  await expect(createMuseClient({ apiKey: '', fetcher }).museText('Hi')).rejects.toThrow('not configured');
  const client = createMuseClient({ apiKey: 'test-key', fetcher });
  await expect(client.museText('Hi', 'other-model' as any)).rejects.toThrow('Unsupported');
  await expect(client.museImage('a'.repeat(4001))).rejects.toThrow('4000');
  await expect(client.museSearchBook('', '')).rejects.toThrow('Enter');
  expect(calls).toBe(0);
});

test('book lookup uses Spark and validates uncertainty and candidate schema', async () => {
  let content: any = { candidate: null, uncertainty: 'Cannot identify this book.' };
  const client = createMuseClient({ apiKey: 'test-key', fetcher: (async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe('meta/muse-spark-1.3');
    expect(body.messages[0].content).toContain('not a web search');
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost: 0.003 } });
  }) as typeof fetch });
  expect(await client.museSearchBook('Unknown', '')).toEqual({ candidate: null, uncertainty: 'Cannot identify this book.', provenance: 'model-memory', costUsd: 0.003 });
  content = { candidate: { title: 'Only a title' }, uncertainty: 'Maybe' };
  await expect(client.museSearchBook('Unknown', '')).rejects.toMatchObject({ message: 'Muse returned an invalid book match.', costUsd: 0.003 });
});

test('Muse Image uses dedicated endpoint, validates raster signature, and reports billed parse errors', async () => {
  let image: any = { b64_json: png };
  const client = createMuseClient({ apiKey: 'test-key', fetcher: (async (url, options) => {
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(JSON.parse(String(options?.body)).model).toBe('meta/muse-image');
    return Response.json({ data: [image], usage: { cost: 0.01 } });
  }) as typeof fetch });
  expect(await client.museImage('A cover')).toEqual({ dataUri: `data:image/png;base64,${png}`, mimeType: 'image/png', costUsd: 0.01 });
  image = { url: 'https://untrusted.example/image.png' };
  await expect(client.museImage('A cover')).rejects.toMatchObject({ message: 'Muse returned no inline image.', costUsd: 0.01 });
  image = { b64_json: 'PHNjcmlwdD5iYWQ8L3NjcmlwdD4=' };
  await expect(client.museImage('A cover')).rejects.toThrow('unsupported image data');
});
