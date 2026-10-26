import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { diff, fileOf, pageHash, sitemapUrls } from '../indexnow-changed.mjs';

const dist = fileURLToPath(new URL('./fixture/dist', import.meta.url));
const cli = fileURLToPath(new URL('../indexnow-changed.mjs', import.meta.url));

test('reads page addresses from the sitemaps, not the index entries', () => {
  assert.deepEqual(sitemapUrls(dist).sort(), ['https://example.ee/', 'https://example.ee/teenused/']);
});

test('finds the built file for an address', () => {
  assert.match(fileOf(dist, 'https://example.ee/teenused/'), /teenused\/index\.html$/);
  assert.equal(fileOf(dist, 'https://example.ee/pole/'), undefined);
});

test('a menu, footer or bundle name change does not count, the page content does', () => {
  const page = (nav, css, h1) => `<html><head><title>T</title><link href="/_astro/Site.${css}.css"></head><body><nav>${nav}</nav><main><h1>${h1}</h1></main></body></html>`;
  assert.equal(pageHash(page('a', 'X1', 'Tere')), pageHash(page('b', 'Y2', 'Tere')));
  assert.notEqual(pageHash(page('a', 'X1', 'Tere')), pageHash(page('a', 'X1', 'Head aega')));
});

test('sends new and changed pages and the ones that left the sitemap', () => {
  const { changed, removed } = diff({ a: '1', b: '2', c: '3' }, { a: '1', b: 'old', gone: '9' });
  assert.deepEqual(changed, ['b', 'c']);
  assert.deepEqual(removed, ['gone']);
});

test('--dry lists everything on the first run and sends nothing', () => {
  const memory = join(mkdtempSync(join(tmpdir(), 'indexnow-')), 'memory.json');
  const out = execFileSync('node', [cli, '--site', 'https://example.ee', '--key', 'abc', '--dist', dist, '--memory', memory, '--dry'], { encoding: 'utf8' });
  assert.match(out, /2 new or changed, 0 removed/);
  assert.match(out, /--dry, nothing sent/);
});

test('nothing to send when the memory matches the build', () => {
  const memory = join(mkdtempSync(join(tmpdir(), 'indexnow-')), 'memory.json');
  const pages = Object.fromEntries(sitemapUrls(dist).map((url) => [url, pageHash(execFileSync('cat', [fileOf(dist, url)], { encoding: 'utf8' }))]));
  writeFileSync(memory, JSON.stringify({ pages }));
  const out = execFileSync('node', [cli, '--site', 'https://example.ee', '--key', 'abc', '--dist', dist, '--memory', memory], { encoding: 'utf8' });
  assert.match(out, /nothing changed/);
});
