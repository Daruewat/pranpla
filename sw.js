/* พรานปลา service worker: ตัวแอปใช้ออฟไลน์ได้ + เก็บแผนที่ที่เคยเปิดดู + แผนที่ที่ดาวน์โหลดไว้ */
const V = 'pranpla-v6', TILES = 'pranpla-tiles2', OFFLINE = 'pranpla-offline', FONTS = 'pranpla-fonts';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'lib/leaflet.js', 'lib/leaflet.css', 'lib/suncalc.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com', 'tile.opentopomap.org'];
const TILE_MAX = 5000;

self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('pranpla-') && ![V, TILES, OFFLINE, FONTS].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())));

async function trim(cache) { const ks = await cache.keys(); if (ks.length > TILE_MAX) await Promise.all(ks.slice(0, ks.length - TILE_MAX).map(k => cache.delete(k))); }

async function tile(req) {
  const off = await caches.open(OFFLINE), hit = (await off.match(req.url)) || (await (await caches.open(TILES)).match(req.url));
  if (hit) return hit;                                   // ของที่เก็บไว้ก่อน ถ้าไม่มีค่อยโหลด
  const res = await fetch(req);
  if (res.ok) { const c = await caches.open(TILES); c.put(req.url, res.clone()); if (Math.random() < .02) trim(c); }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) { if (req.destination === 'image') e.respondWith(tile(req)); return; }   // การดาวน์โหลดออฟไลน์จากหน้าแอปเก็บลงแคชเอง
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(caches.open(FONTS).then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { if (r.ok) caches.open(V).then(c => c.put(req, r.clone())); return r; }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
