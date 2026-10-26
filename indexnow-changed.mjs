#!/usr/bin/env node
// Tells IndexNow which pages of a static site changed since the last deploy.
// One submission reaches Bing and every engine that shares IndexNow (Yandex,
// Seznam, Naver, Yep and others); Google does not take part.
//
// It reads the built site (the folder you deploy), lists the addresses in its
// sitemap, and compares each page with what this machine submitted last time.
// Only new, changed and removed addresses are sent, as IndexNow asks. The
// first run has nothing to compare with and sends every address in the
// sitemap.
//
//   indexnow-changed --site https://example.ee --key <key> [--dist dist] [--all] [--dry]
//
// The key is not a secret: the same text must be online at
// https://example.ee/<key>.txt, which is how the engines check that the
// submission comes from the site. INDEXNOW_KEY works instead of --key.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The answers IndexNow documents (indexnow.org/documentation).
const ANSWERS = {
  200: 'accepted',
  202: 'received, the key is still being checked',
  400: 'invalid format',
  403: 'key not valid: the key file is missing or does not hold the key',
  422: 'an address is not on the site, or the key does not fit the protocol',
  429: 'too many requests, seen as possible spam',
};

// Hashed file names of bundlers (Astro, Vite, Next.js) change with every style
// or code edit; counting them would mark every page as changed.
const BUNDLED = /\/(?:_astro|assets|_next\/static)\/[^"'\s)]+/g;

// Only what belongs to the page itself counts: its title, description,
// canonical and language links and its <main>. A menu or footer edit would
// otherwise send every address. A page without a <main> counts whole.
const OWN = /<title>[\s\S]*?<\/title>|<meta name="description"[^>]*>|<link rel="(?:canonical|alternate)"[^>]*>|<main[\s>][\s\S]*<\/main>/g;

export function parseArgs(argv) {
  const value = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    site: (value('--site') ?? process.env.INDEXNOW_SITE ?? '').replace(/\/$/, ''),
    key: value('--key') ?? process.env.INDEXNOW_KEY ?? '',
    dist: value('--dist') ?? 'dist',
    memory: value('--memory'),
    all: argv.includes('--all'),
    dry: argv.includes('--dry'),
  };
}

/** Every page address in the build's sitemaps (sitemap.xml, sitemap-0.xml…), not the index entries. */
export function sitemapUrls(dist) {
  const files = readdirSync(dist).filter((name) => /^sitemap[\w-]*\.xml$/.test(name));
  if (files.length === 0) throw new Error(`No sitemap*.xml in ${dist}: build the site first.`);
  const urls = files.flatMap((name) => [...readFileSync(join(dist, name), 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]));
  return [...new Set(urls.filter((url) => !/\.xml$/i.test(url)))];
}

/** /teenused/ → dist/teenused/index.html, /about → dist/about.html or dist/about/index.html. */
export function fileOf(dist, url) {
  const path = decodeURIComponent(new URL(url).pathname);
  const candidates = path.endsWith('/') ? [join(dist, path, 'index.html')] : [join(dist, `${path}.html`), join(dist, path, 'index.html'), join(dist, path)];
  return candidates.find((file) => existsSync(file) && statSync(file).isFile());
}

export function pageHash(html) {
  const own = html.match(OWN) ?? [];
  const text = own.some((part) => part.startsWith('<main')) ? own.join('\n') : html;
  return createHash('sha256').update(text.replace(BUNDLED, '/_bundled/')).digest('hex');
}

/** What to send: new and changed pages, plus pages that left the sitemap. */
export function diff(now, before) {
  const changed = Object.keys(now).filter((url) => before[url] !== now[url]);
  const removed = Object.keys(before).filter((url) => !(url in now));
  return { changed, removed };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.site || !opts.key) throw new Error('Give --site https://your.site and --key <key> (or INDEXNOW_SITE and INDEXNOW_KEY).');
  if (!existsSync(opts.dist)) throw new Error(`No ${opts.dist} folder: build the site first, or give --dist.`);
  const host = new URL(opts.site).host;
  const keyUrl = `${opts.site}/${opts.key}.txt`;
  // In the home folder, not the project: it outlives a fresh clone or `npm ci`.
  const memory = opts.memory ?? join(homedir(), '.cache', 'indexnow', `${host}.json`);

  const now = {};
  for (const url of sitemapUrls(opts.dist)) {
    const file = fileOf(opts.dist, url);
    if (file) now[url] = pageHash(readFileSync(file, 'utf8'));
  }
  const remembered = existsSync(memory);
  const before = !opts.all && remembered ? JSON.parse(readFileSync(memory, 'utf8')).pages ?? {} : {};
  if (!opts.all && !remembered) console.log(`indexnow: no earlier submission from this machine (${memory}), so every address goes`);
  const { changed, removed } = diff(now, before);
  const urlList = [...changed, ...removed];

  if (urlList.length === 0) {
    console.log('indexnow: nothing changed since the last submission');
    return;
  }
  console.log(`indexnow: ${changed.length} new or changed, ${removed.length} removed`);
  console.log(urlList.map((url) => `  ${url}`).join('\n'));
  if (opts.dry) {
    console.log('indexnow: --dry, nothing sent');
    return;
  }

  // The engines fetch the key file before they accept anything. A new deploy
  // can take a few seconds to reach every edge, hence the second and third try.
  let live = false;
  for (let attempt = 1; attempt <= 3 && !live; attempt++) {
    if (attempt > 1) await new Promise((done) => setTimeout(done, 5000));
    try {
      const answer = await fetch(keyUrl, { signal: AbortSignal.timeout(10_000) });
      live = answer.ok && (await answer.text()).trim() === opts.key;
    } catch {
      // Offline or slow: the next try, or the message below.
    }
  }
  if (!live) {
    console.error(`indexnow: ${keyUrl} does not answer with the key. Nothing was sent.`);
    process.exitCode = 1;
    return;
  }

  let response;
  let body;
  try {
    response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: opts.key, keyLocation: keyUrl, urlList: urlList.slice(0, 10_000) }),
      signal: AbortSignal.timeout(30_000),
    });
    // A 202 alone is no proof anything will be crawled: the body may say why.
    body = await response.text();
  } catch (error) {
    console.error(`indexnow: could not reach api.indexnow.org (${[error.message, error.cause?.message].filter(Boolean).join(': ')})`);
    process.exitCode = 1;
    return;
  }
  console.log(`indexnow: ${response.status} ${ANSWERS[response.status] ?? ''} ${body}`.replace(/\s+/g, ' ').trim());

  // Only an accepted submission is remembered, so a failed one is sent again
  // on the next run.
  if (response.status === 200 || response.status === 202) {
    mkdirSync(dirname(memory), { recursive: true });
    writeFileSync(memory, JSON.stringify({ pages: now }, null, 2));
  } else {
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(`indexnow: ${error.message}`);
    process.exitCode = 1;
  });
}
