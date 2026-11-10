import { expect, test } from 'bun:test';
import { releaseIdentity, releaseManifest, releaseLauncher } from '../tools/testflight.mjs';
import { readFileSync } from 'node:fs';

test('release launchers select the native crate generated for their own directory', () => {
  const template = readFileSync(new URL('../container/exact.mjs', import.meta.url), 'utf8');
  const standalone = releaseLauncher(template, '/tmp/releases/plant-tracker');
  expect(standalone).toContain('name: "plant-tracker"');
  expect(standalone).not.toContain('name: "container"');
  expect(releaseLauncher(template, '/tmp/releases/container')).toBe(template);
  expect(() => releaseLauncher('unexpected template', '/tmp/releases/app')).toThrow('missing');
});

test('standalone TestFlight identities are distinct from preview and gallery', () => {
  expect(releaseIdentity('plant-tracker')).toBe('com.exactcreate.generated.plant-tracker');
  expect(releaseIdentity('water-tracker')).not.toBe(releaseIdentity('plant-tracker'));
  expect(releaseIdentity('gallery', true)).toBe('com.exactcreate.gallery');
  expect(() => releaseIdentity('../bad')).toThrow();
});
test('release manifest embeds sources without the local preview endpoint', () => {
  const base = { app: {}, host: { ios: { localNetworking: 'preview', minimumOS: '17.0' } }, icons: [{ src: 'assets/app-icon.png' }], deploy: { store: { ios: 'live-stream' } } };
  const result = releaseManifest(base, { id: 'plant-tracker', name: 'Plant Tracker' });
  expect(result.app).toEqual({ id: 'com.exactcreate.generated.plant-tracker', name: 'Plant Tracker' });
  expect(result.deploy.store.ios).toBe('0');
  expect(result.host.ios.localNetworking).toBeUndefined();
  expect(result.icons).toEqual(base.icons);
  expect(base.host.ios.localNetworking).toBe('preview');
});
