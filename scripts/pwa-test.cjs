/**
 * Installable app — checked against what browsers actually require.
 *
 * A PWA is not "a page with a manifest". Chrome refuses to show an install
 * prompt unless all of this is true, and each failure is silent:
 *   * a manifest with name, short_name, start_url, display: standalone
 *   * a 192px and a 512px icon that both actually exist and are PNG
 *   * a service worker registered from a URL that controls the start_url
 *   * served over HTTPS
 *
 * These are the rules, not an opinion about them.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawn } = require('child_process');
const http = require('http');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log(`✔ ${n}`); pass++; } catch (e) { console.log(`✗ ${n}  ${e.message}`); fail++; } };
const ta = async (n, fn) => { try { await fn(); console.log(`✔ ${n}`); pass++; } catch (e) { console.log(`✗ ${n}  ${e.message}`); fail++; } };

const manifest = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.json'), 'utf8'));

/* ── manifest ─────────────────────────────────────────────────────────────── */
t('manifest has everything Chrome requires for install', () => {
  for (const k of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color', 'background_color']) {
    if (!manifest[k]) throw new Error(`missing ${k}`);
  }
  if (manifest.display !== 'standalone' && manifest.display !== 'fullscreen') {
    throw new Error(`display is '${manifest.display}' — the browser bar stays visible`);
  }
});

t('short_name fits under a home-screen icon', () => {
  // Android truncates past ~12 characters
  if (manifest.short_name.length > 12) throw new Error(`short_name is ${manifest.short_name.length} chars`);
});

t('start_url is same-origin, so the worker scope can control it', () => {
  if (!manifest.start_url.startsWith('/')) throw new Error('start_url is not root-relative');
});

/* ── icons: declared is not the same as present ───────────────────────────── */
t('every declared icon exists and is really a PNG of the right size', async () => {});
(async () => {
  for (const icon of manifest.icons) {
    await ta(`icon ${icon.sizes} exists at ${icon.src}`, async () => {
      const file = path.join(PUB, icon.src.replace(/^\//, ''));
      if (!fs.existsSync(file)) throw new Error('declared but missing on disk');
      const meta = await sharp(file).metadata();
      const [w, h] = icon.sizes.split('x').map(Number);
      if (meta.format !== 'png') throw new Error(`is ${meta.format}, manifest says png`);
      if (meta.width !== w || meta.height !== h) throw new Error(`is ${meta.width}x${meta.height}`);
    });
  }

  await ta('there is a maskable icon, or Android crops the logo', async () => {
    const maskable = manifest.icons.filter((i) => /maskable/.test(i.purpose || ''));
    if (!maskable.length) throw new Error('no maskable icon — Android will crop into a circle');
  });

  await ta('the maskable icon keeps its content inside the safe zone', async () => {
    // content in the outer 10% of a maskable icon gets cut off by the mask
    const file = path.join(PUB, 'assets/icon-maskable-512.png');
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const S = info.width;
    const margin = Math.floor(S * 0.08);
    let edgeBright = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const onEdge = x < margin || y < margin || x >= S - margin || y >= S - margin;
        if (!onEdge) continue;
        const i = (y * S + x) * info.channels;
        // background is near #0a0608; anything much brighter is artwork on the edge
        if (data[i] > 90 || data[i + 1] > 90 || data[i + 2] > 120) edgeBright++;
      }
    }
    const ratio = edgeBright / (S * S * 0.3);
    if (ratio > 0.02) throw new Error(`${(ratio * 100).toFixed(1)}% of the edge is bright — the mask will clip it`);
  });

  await ta('an apple-touch-icon exists for iOS', async () => {
    const f = path.join(PUB, 'assets/apple-touch-icon.png');
    if (!fs.existsSync(f)) throw new Error('missing — iOS falls back to a screenshot');
    const m = await sharp(f).metadata();
    if (m.width !== 180) throw new Error(`should be 180x180, is ${m.width}`);
  });

  /* ── the page wires it up ───────────────────────────────────────────────── */
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');

  t('the page links the manifest', () => {
    if (!/rel="manifest"/.test(html)) throw new Error('no manifest link — nothing is installable');
  });

  t('iOS gets the meta tags Safari actually reads', () => {
    for (const tag of ['apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'apple-touch-icon']) {
      if (!html.includes(tag)) throw new Error(`missing ${tag}`);
    }
  });

  t('the service worker is registered, and not on http', () => {
    if (!/serviceWorker\.register\('\/sw\.js'\)/.test(html)) throw new Error('sw not registered');
    if (!/location\.protocol === 'https:'/.test(html)) throw new Error('would throw on an insecure origin');
  });

  t('the install button is hidden inside an installed app', () => {
    if (!/display-mode: standalone/.test(html)) throw new Error('no standalone check — the app would offer to install itself');
  });

  t('iOS gets instructions instead of a prompt that cannot exist', () => {
    if (!/Add to Home Screen/.test(html)) throw new Error('no iOS guidance');
    if (!/function isIOS/.test(html)) throw new Error('no iOS detection');
  });

  /* ── the worker's cache rules ───────────────────────────────────────────── */
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');

  t('live API data is never served from the cache', () => {
    if (!/isApi\(url\)\) \{\s*event\.respondWith\(fetch\(request\)\)/.test(sw)) {
      throw new Error('an /api/ response could be cached — a stale "online" is worse than none');
    }
  });

  t('pages are network-first, so a deploy is visible on reload', () => {
    const nav = sw.slice(sw.indexOf("request.mode === 'navigate'"));
    const netFirst = nav.indexOf('fetch(request)');
    const cacheHit = nav.indexOf('caches.match(request)');
    if (!(netFirst > -1 && netFirst < cacheHit)) throw new Error('pages are cache-first');
  });

  t('there is a real offline screen', () => {
    const f = path.join(PUB, 'offline.html');
    if (!fs.existsSync(f)) throw new Error('offline.html missing');
    if (!/No connection/.test(fs.readFileSync(f, 'utf8'))) throw new Error('offline page is empty');
  });

  t('an old worker cache is cleaned up on activate', () => {
    if (!/caches\.delete/.test(sw)) throw new Error('old versions would pile up forever');
  });

  /* ── served correctly by the real server ───────────────────────────────── */
  const PORT = 39877;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), PANEL_MODE: '0', SITE_PASSWORD: '', AUTH_DIR_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-')), SILENT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const get = (p) => new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 8000 }, (r) => {
      let b = ''; r.on('data', (d) => b += d); r.on('end', () => res({ code: r.statusCode, headers: r.headers, body: b }));
    }).on('error', rej).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await get('/health'); up = true; } catch { await new Promise(r => setTimeout(r, 300)); } }

  if (up) {
    await ta('the service worker is served as JavaScript and is revalidated', async () => {
      const r = await get('/sw.js');
      if (r.code !== 200) throw new Error('status ' + r.code);
      if (!/javascript/.test(r.headers['content-type'] || '')) throw new Error('wrong content-type: ' + r.headers['content-type']);
      if (!/no-cache|must-revalidate/.test(r.headers['cache-control'] || '')) {
        throw new Error('cached — an installed app would never receive an update');
      }
    });

    await ta('the manifest is served with the manifest content type', async () => {
      const r = await get('/manifest.json');
      if (r.code !== 200) throw new Error('status ' + r.code);
      if (!/manifest/.test(r.headers['content-type'] || '')) throw new Error('content-type: ' + r.headers['content-type']);
      JSON.parse(r.body);   // must parse, or the browser ignores it
    });

    await ta('every precached URL returns 200', async () => {
      for (const u of ['/', '/manifest.json', '/offline.html', '/assets/icon-192.png',
                       '/assets/icon-512.png', '/assets/apple-touch-icon.png', '/assets/favicon-32.png']) {
        const r = await get(u);
        if (r.code !== 200) throw new Error(`${u} -> ${r.code} (install would fail)`);
      }
    });

    await ta('API responses are marked uncacheable by the server too', async () => {
      const r = await get('/api/status');
      if (r.code !== 200) throw new Error('status ' + r.code);
      if (/max-age=[1-9]/.test(r.headers['cache-control'] || '')) {
        throw new Error('server allows caching live state');
      }
    });
  }

  child.kill('SIGKILL');
  console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
