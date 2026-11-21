/* พรานปลา service worker: ตัวแอปใช้ออฟไลน์ได้ + เก็บแผนที่ที่เคยเปิดดู + แผนที่ที่ดาวน์โหลดไว้ */
const V = 'pranpla-v90', TILES = 'pranpla-tiles2', OFFLINE = 'pranpla-offline', FONTS = 'pranpla-fonts';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'icons.js', 'group.js', 'spots.js', 'firebase-config.js', 'lib/fb/firebase-app-compat.js', 'lib/fb/firebase-auth-compat.js', 'lib/fb/firebase-firestore-compat.js', 'vecstyle.js', 'waterfix.json', 'lib/pmtiles.js', 'lib/mlcontour.js', 'tambon.json', 'lib/leaflet.js', 'lib/maplibre-gl.js', 'lib/maplibre-gl.css', 'lib/leaflet-maplibre-gl.js', 'lib/leaflet.css', 'lib/suncalc.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
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
  if (res.ok) { const cp = res.clone(), c = await caches.open(TILES); c.put(req.url, cp); if (Math.random() < .02) trim(c); }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hash === '#dl') return;                        // การดาวน์โหลดออฟไลน์จากหน้าแอป: หน้าแอปเก็บลงแคชเอง
  if (url.hostname === 'tiles.openfreemap.org') {       // แผนที่เวกเตอร์: ตัวชี้เวอร์ชันโหลดใหม่ก่อน ส่วนแผ่นแผนที่/ฟอนต์ใช้ของที่เก็บไว้ก่อน
    if (/\/planet\/?$/.test(url.pathname)) e.respondWith(fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(TILES).then(c => c.put(req.url, cp)); } return r; }).catch(() => caches.open(TILES).then(c => c.match(req.url)).then(r => r || Response.error())));
    else e.respondWith(tile(req));
    return;
  }
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) { if (req.destination === 'image' || req.destination === '') e.respondWith(tile(req)); return; }
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(caches.open(FONTS).then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(fetch(req.url, { cache: 'no-cache' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(req, cp)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});

self.addEventListener('notificationclick', e => {   // แตะแจ้งเตือน: กลับไปที่แอปแล้วเปิดรายการแจ้งเตือน
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => x.url.includes(self.registration.scope)) || cs[0];
    if (c) { c.postMessage({ openNoti: true }); return c.focus(); }
    return self.clients.openWindow(e.notification.data?.url || './#noti');
  }));
});
