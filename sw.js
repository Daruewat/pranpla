/* พรานปลา service worker: ตัวแอปใช้ออฟไลน์ได้ + เก็บแผนที่ที่เคยเปิดดูไว้ */
const V = 'pranpla-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'lib/leaflet.js', 'lib/leaflet.css', 'lib/suncalc.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com', 'tile.opentopomap.org', 'basemaps.cartocdn.com'];
const TILE_MAX = 4000;

self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('pranpla-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));

async function trim(cache) { const ks = await cache.keys(); if (ks.length > TILE_MAX) await Promise.all(ks.slice(0, ks.length - TILE_MAX).map(k => cache.delete(k))); }

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // แผนที่: ใช้ของที่เก็บไว้ก่อน ถ้าไม่มีค่อยโหลด
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    e.respondWith(caches.open('pranpla-tiles').then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); if (Math.random() < .02) trim(c); }
      return res;
    }));
    return;
  }
  // ฟอนต์: เก็บไว้ใช้ออฟไลน์
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(caches.open('pranpla-fonts').then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
    return;
  }
  // ตัวแอป: โหลดใหม่ก่อน ถ้าไม่มีเน็ตใช้ของเดิม
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { if (r.ok) caches.open(V).then(c => c.put(req, r.clone())); return r; }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
