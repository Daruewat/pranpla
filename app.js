'use strict';
/* ============ helpers ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = n => String(n).padStart(2, '0');
const hm = d => (d && !isNaN(d)) ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '--:--';
const DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function dist(a, b) { // เมตร
  const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const fmtDist = m => m == null ? '-' : m < 1000 ? Math.round(m) + ' ม.' : (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' กม.';
const DIR8 = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
const DIR8E = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const dirTxt = d => DIR8[Math.round(d / 45) % 8];
const dirE = d => DIR8E[Math.round(d / 45) % 8];
function dms(v, pos, neg) {
  const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
  return `${d}°${pad(m)}'${s.toFixed(1)}"${v >= 0 ? pos : neg}`;
}

/* ============ storage (IndexedDB key-value) ============ */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('pranpla', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode), rq = fn(t.objectStore('kv'));
      t.oncomplete = () => res(rq.result); t.onerror = () => rej(t.error);
    });
  };
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)) };
})();

/* ============ state ============ */
const S = {
  spots: [], catches: [], tracks: [], track: { on: false, pts: [], started: null },
  pos: null, heading: null, target: null, follow: true,
  wx: null, fcLoc: null, layer: ls.get('layer', 'light'), firstFix: false
};
const save = k => DB.set(k, S[k]).catch(() => toast('บันทึกข้อมูลไม่สำเร็จ'));

/* ============ map ============ */
const map = L.map('map', { zoomControl: false }).setView(ls.get('view', [18.79, 98.98]), ls.get('zoom', 13));
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const TL = (u, o) => L.tileLayer(u, { crossOrigin: true, maxZoom: 19, ...o });
const LAYERS = {
  vec: { short: 'เรียบง่าย', name: 'พรานปลา (เวกเตอร์)', ico: '🎣', desc: 'โทนสีเข้ากับแอป ซูมลื่น ตัวหนังสือคม เปลี่ยนตามธีมมืด/สว่าง · ออฟไลน์ใช้พื้นที่น้อย', maxZ: 14, kb: 22, urls: [], make: makeVec },
  light: { short: 'ถนน', name: 'แผนที่', ico: '🗺️', desc: 'สว่าง อ่านง่าย ชื่อสถานที่ภาษาไทย', urls: [OSM], maxZ: 18, kb: 18, l: TL(OSM, { attribution: '© OpenStreetMap' }) },
  sat: { name: 'ดาวเทียม', ico: '🛰️', desc: 'ภาพถ่ายจริง + ชื่อสถานที่ เห็นแนวน้ำ กอหญ้า ทางเข้า', maxZ: 18, kb: 30,
    urls: [ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
    l: L.layerGroup([TL(ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, attribution: 'Esri, Maxar' }), TL(ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18 })]) },
  map: { name: 'กลางคืน', ico: '🌙', desc: 'โทนมืด ถนอมสายตาและแบต', urls: [OSM], maxZ: 18, kb: 18, l: TL(OSM, { className: 'dark-tiles', attribution: '© OpenStreetMap' }) },
  topo: { name: 'ภูมิประเทศ', ico: '⛰️', desc: 'เส้นชั้นความสูง ลำห้วย ทางเดินป่า', urls: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'], maxZ: 16, kb: 28, l: TL('https://a.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap' }) }
};
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
const curTheme = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
async function makeVec() {   // โหลดตัววาดแผนที่เวกเตอร์เฉพาะตอนเลือกใช้
  if (!window.maplibregl) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'lib/maplibre-gl.css'; document.head.appendChild(l); await loadScript('lib/maplibre-gl.js'); await loadScript('lib/leaflet-maplibre-gl.js'); await loadScript('vecstyle.js'); }
  if (!maplibregl.supported?.() && !document.createElement('canvas').getContext('webgl')) throw new Error('no webgl');
  fetch('https://tiles.openfreemap.org/planet').then(r => r.json()).then(j => { if (j.tiles?.[0]) LAYERS.vec.urls = [j.tiles[0]]; }).catch(() => {});
  return L.maplibreGL({ style: vecStyle(curTheme()), attribution: '© OpenStreetMap · OpenFreeMap' });
}
function vecRestyle() { const l = LAYERS.vec.l; try { l?.getMaplibreMap?.()?.setStyle(vecStyle(curTheme())); } catch {} }
let layerSeq = 0;
async function setLayer(k) {
  const seq = ++layerSeq, o = LAYERS[k];
  if (o.make && !o.l) { try { toast('กำลังโหลดแผนที่เวกเตอร์…'); o.l = await o.make(); } catch { toast('เครื่อง/เบราว์เซอร์นี้เปิดแผนที่เวกเตอร์ไม่ได้ ใช้แผนที่ปกติแทน'); if (seq === layerSeq) return setLayer('light'); return; } }
  if (seq !== layerSeq) return;
  Object.values(LAYERS).forEach(x => x.l && map.removeLayer(x.l));
  o.l.addTo(map); S.layer = k; ls.set('layer', k); $('#layerName').textContent = k === 'vec' ? 'เวกเตอร์' : o.name;
  if (k === 'vec') vecRestyle();
}
setLayer(LAYERS[S.layer] ? S.layer : 'light');
const searchPin = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="mk" style="background:#e11d48"><span>🔎</span></div>', iconSize: [34, 34], iconAnchor: [17, 34] }) });
const gSpots = L.layerGroup().addTo(map), gWater = L.layerGroup().addTo(map);
const trackLine = L.polyline([], { color: '#ef4444', weight: 4, opacity: .85 }).addTo(map);
const targetLine = L.polyline([], { color: '#f59e0b', weight: 3, dashArray: '8 8' }).addTo(map);
let meMarker = null, accCircle = null;

map.on('moveend', () => { const c = map.getCenter(); ls.set('view', [c.lat, c.lng]); ls.set('zoom', map.getZoom()); });
map.on('dragstart', () => { S.follow = false; $('#btnLocate').classList.remove('follow'); });
map.on('contextmenu', e => M.on || spotForm({ lat: e.latlng.lat, lng: e.latlng.lng }));   // กดค้าง = ปักหมุด
map.on('click', () => { closeSearch(); map.removeLayer(searchPin); });

function spotIcon(type) {
  const t = SPOT_TYPES[type] || SPOT_TYPES.other;
  return L.divIcon({ className: '', html: `<div class="mk" style="background:${t.color}"><span>${t.icon}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 34] });
}
const OPT = Object.assign({ types: null, catches: false, cross: false, heat: false, water: true }, ls.get('mapopt', {}));
const saveOpt = () => ls.set('mapopt', OPT);
const gCatch = L.layerGroup().addTo(map), gHeat = L.layerGroup().addTo(map);
function renderSpots() {
  gSpots.clearLayers(); gCatch.clearLayers(); gHeat.clearLayers();
  S.spots.filter(s => !OPT.types || OPT.types.includes(s.type)).forEach(s => L.marker([s.lat, s.lng], { icon: spotIcon(s.type) }).on('click', () => spotSheet(s.id)).addTo(gSpots));
  const C = S.catches.filter(c => c.lat != null);
  if (OPT.catches) C.forEach(c => L.marker([c.lat + (Math.random() - .5) * 8e-5, c.lng + (Math.random() - .5) * 8e-5], { icon: L.divIcon({ className: '', html: '<div class="cmk">🐟</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).on('click', () => catchSheet(c.id)).addTo(gCatch));
  if (OPT.heat) C.forEach(c => L.marker([c.lat, c.lng], { interactive: false, zIndexOffset: -1000, icon: L.divIcon({ className: '', html: '<div class="heat"></div>', iconSize: [110, 110], iconAnchor: [55, 55] }) }).addTo(gHeat));
  if (OPT.water) { if (!map.hasLayer(gWater)) gWater.addTo(map); } else map.removeLayer(gWater);
}
function updateCoordBar() {
  const el = $('#coordBar'); updateCross();
  if (S.pos) el.textContent = `${S.pos.lat.toFixed(5)}, ${S.pos.lng.toFixed(5)} ±${Math.round(S.pos.acc)}ม.`;
}
function updateCross() {
  if ($('#crosshair').classList.contains('hidden')) return;
  $('#crossSV').href = svUrl({ lat: map.getCenter().lat, lng: map.getCenter().lng });
  const c = map.getCenter(), d = S.pos ? dist(S.pos, { lat: c.lat, lng: c.lng }) : null;
  $('#crossLbl').innerHTML = `<b>${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</b>${d != null && d > 15 ? `<small>ห่าง ${fmtDist(d)} · ทิศ ${Math.round(bearing(S.pos, { lat: c.lat, lng: c.lng }))}° ${dirE(bearing(S.pos, { lat: c.lat, lng: c.lng }))}</small>` : ''}`;
}
map.on('move', () => { if (OPT.cross) updateCoordBar(); updateCross(); });
$('#crossSV').addEventListener('click', e => { const c = map.getCenter(); e.currentTarget.href = svUrl({ lat: c.lat, lng: c.lng }); });   // ตั้งลิงก์ตอนแตะ กันกรณีลิงก์ยังไม่ถูกตั้ง
$('#crossLbl').onclick = () => { const c = map.getCenter(); copy(`${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`, 'คัดลอกพิกัดที่เล็งแล้ว'); };
function updateMe() {
  if (!S.pos) return;
  const ll = [S.pos.lat, S.pos.lng];
  const html = `<div class="me">${S.heading != null ? `<div class="cone" style="transform:rotate(${S.heading}deg)"></div>` : ''}<div class="dot"></div></div>`;
  const icon = L.divIcon({ className: '', html, iconSize: [22, 22], iconAnchor: [11, 11] });
  if (!meMarker) {
    meMarker = L.marker(ll, { icon, zIndexOffset: 1000, interactive: false }).addTo(map);
    accCircle = L.circle(ll, { radius: S.pos.acc || 0, color: '#3b82f6', weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
  } else { meMarker.setLatLng(ll).setIcon(icon); accCircle.setLatLng(ll).setRadius(S.pos.acc || 0); }
  targetLine.setLatLngs(S.target ? [ll, [S.target.lat, S.target.lng]] : []);
}

/* ============ GPS ============ */
function onPos(p) {
  S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, spd: p.coords.speed, t: p.timestamp };
  updateCoordBar();
  if (!S.firstFix) {
    S.firstFix = true;
    if (!S.noCenter) { map.setView([S.pos.lat, S.pos.lng], Math.max(map.getZoom(), 14)); $('#btnLocate').classList.add('follow'); }
    if (!S.fcLoc || S.fcLoc.auto) loadForecast({ lat: S.pos.lat, lng: S.pos.lng, name: 'ตำแหน่งของฉัน', auto: true });
  } else if (S.follow) map.panTo([S.pos.lat, S.pos.lng], { animate: true });
  if (S.track.on && S.pos.acc < 40) {
    const last = S.track.pts[S.track.pts.length - 1];
    if (!last || dist({ lat: last[0], lng: last[1] }, S.pos) > 8) {
      S.track.pts.push([+S.pos.lat.toFixed(6), +S.pos.lng.toFixed(6), Date.now()]);
      trackLine.addLatLng([S.pos.lat, S.pos.lng]);
      if (S.track.pts.length % 5 === 0) save('track');
    }
  }
  updateMe(); renderTools();
}
function startGeo() {
  if (!navigator.geolocation) { $('#coordBar').textContent = 'เครื่องนี้ไม่มี GPS'; return; }
  navigator.geolocation.watchPosition(onPos, e => {
    $('#coordBar').textContent = e.code === 1 ? 'ยังไม่ได้อนุญาตตำแหน่ง – เปิดสิทธิ์ตำแหน่งให้แอปนี้' : 'ยังจับ GPS ไม่ได้ – ออกไปที่โล่ง รอ 1–2 นาที';
  }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 30000 });
}
$('#btnLocate').onclick = () => {
  if (!S.pos) { toast('ยังไม่ได้ตำแหน่ง GPS'); startGeo(); return; }
  S.follow = true; $('#btnLocate').classList.add('follow'); map.setView([S.pos.lat, S.pos.lng], Math.max(map.getZoom(), 15));
};
function mapOptSheet() {
  const sw = (k, ico, title, sub) => `<label class="optrow"><span class="oi">${ico}</span><span class="ot"><b>${title}</b><small>${sub}</small></span><input type="checkbox" class="switch" data-opt="${k}" ${OPT[k] ? 'checked' : ''}></label>`;
  openSheet(`<h3>ตัวเลือกแผนที่</h3>
  <div class="card-h" style="font-size:15px;margin-top:6px">รูปแบบแผนที่</div>
  <div class="stylegrid">${Object.entries(LAYERS).map(([k, o]) => `<button data-layer="${k}" class="${k === S.layer ? 'sel' : ''}"><span>${o.ico}</span>${o.short || o.name}</button>`).join('')}</div>
  <div class="card-h" style="font-size:15px;margin-top:14px">กรองหมุด <span class="sub" style="font-weight:400">แตะเพื่อซ่อน/แสดงแต่ละประเภท</span></div>
  <div class="types" id="optTypes">${Object.entries(SPOT_TYPES).map(([k, t]) => `<button type="button" data-type="${k}" class="${!OPT.types || OPT.types.includes(k) ? 'sel' : ''}">${t.icon} ${t.label}</button>`).join('')}</div>
  ${sw('catches', '🐟', 'ปลาที่ฉันจับได้', 'แสดงจุดที่ได้ปลาแต่ละตัวบนแผนที่')}
  ${sw('heat', '🔥', 'ฮีตแมปของฉัน', 'ระบายสีบริเวณที่ได้ปลาบ่อย จากสมุดบันทึกของคุณเอง')}
  ${sw('water', '💧', 'แหล่งน้ำและระดับน้ำ', 'หมุดจากปุ่มแหล่งน้ำ และ % ของเขื่อน/อ่าง')}
  ${sw('cross', '🎯', 'เส้นเล็ง', 'กากบาทกลางจอ บอกพิกัดและระยะจากตัวคุณ')}
  <button class="menu-item" id="offOpen"><span class="mi">⬇️</span><span><b>เตรียมออฟไลน์สำหรับบริเวณนี้</b><span class="sub">เก็บแผนที่ แหล่งน้ำ ระดับน้ำ และพยากรณ์ ไว้ใช้ตอนไม่มีสัญญาณ</span></span></button>
  <button class="menu-item" data-act="toggle-track"><span class="mi">👣</span><span><b>${S.track.on ? 'หยุดโหมดเดินทาง' : 'โหมดเดินทาง'}</b><span class="sub">บันทึกเส้นทางที่เดิน เปิดจอค้าง ไว้นำทางกลับจุดเริ่ม</span></span></button>`);
  $('#offOpen').onclick = offlineSheet;
  $$('#sheet [data-layer]').forEach(b => b.onclick = () => { setLayer(b.dataset.layer); $$('#sheet [data-layer]').forEach(x => x.classList.toggle('sel', x === b)); });
  $$('#optTypes button').forEach(b => b.onclick = () => {
    b.classList.toggle('sel'); const on = $$('#optTypes button.sel').map(x => x.dataset.type);
    OPT.types = on.length === Object.keys(SPOT_TYPES).length ? null : on; saveOpt(); renderSpots();
  });
  $$('#sheet [data-opt]').forEach(x => x.onchange = () => {
    OPT[x.dataset.opt] = x.checked; saveOpt(); renderSpots(); updateCoordBar();
    if (x.dataset.opt === 'heat' && x.checked && !S.catches.some(c => c.lat != null)) toast('ยังไม่มีปลาในสมุดบันทึก ฮีตแมปจะขึ้นเมื่อบันทึกปลาพร้อมตำแหน่ง');
  });
}
$('#btnLayer').onclick = mapOptSheet;
$('#mapCompass').onclick = () => {
  if (S.heading == null && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') $('#compassPerm').click();
  showTab('tools');
};

/* ============ ดาวน์โหลดแผนที่ออฟไลน์ ============ */
const OFF = { cap: 1200, running: false, cancel: false };
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
function offlinePlan() {
  const ly = LAYERS[S.layer], b = map.getBounds(), z0 = Math.min(Math.round(map.getZoom()), ly.maxZ);
  const list = z1 => { const out = []; for (let z = Math.max(z0 - 3, 5); z <= z1; z++) { const x0 = lon2x(b.getWest(), z), x1 = lon2x(b.getEast(), z), y0 = lat2y(b.getNorth(), z), y1 = lat2y(b.getSouth(), z); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) ly.urls.forEach(u => out.push(u.replace('{z}', z).replace('{x}', x).replace('{y}', y))); } return out; };
  let z1 = Math.min(z0 + 3, ly.maxZ), urls = list(z1);
  while (urls.length > OFF.cap && z1 > z0) urls = list(--z1);
  if (S.layer === 'vec') ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'].forEach(f => ['0-255', '3584-3839', '8192-8447'].forEach(g => urls.push(`https://tiles.openfreemap.org/fonts/${encodeURIComponent(f)}/${g}.pbf`)));   // ตัวอักษรไทย/อังกฤษของแผนที่
  return { urls, z0, z1, ly, tooBig: urls.length > OFF.cap };
}
async function offlineCount() { try { return (await (await caches.open('pranpla-offline')).keys()).length; } catch { return 0; } }
async function offlineSheet() {
  if (!('caches' in window)) { closeSheet(); return toast('เบราว์เซอร์นี้เก็บแผนที่ออฟไลน์ไม่ได้'); }
  if (!LAYERS[S.layer].urls.length) { closeSheet(); return toast('แผนที่เวกเตอร์ยังโหลดข้อมูลไม่เสร็จ ลองใหม่อีกครั้ง'); }
  const p = offlinePlan(), have = await offlineCount(), b = map.getBounds();
  const w = dist({ lat: b.getCenter().lat, lng: b.getWest() }, { lat: b.getCenter().lat, lng: b.getEast() }), h = dist({ lat: b.getNorth(), lng: b.getWest() }, { lat: b.getSouth(), lng: b.getWest() });
  openSheet(`<h3>⬇️ แผนที่ออฟไลน์</h3>
  <div class="kv"><span>ชั้นแผนที่</span><b>${p.ly.ico} ${p.ly.name}</b><span>พื้นที่</span><b>บริเวณที่เห็นบนจอ ~${fmtDist(w)} × ${fmtDist(h)}</b>
  <span>ความละเอียด</span><b>${S.layer === 'vec' && p.z1 >= 14 ? 'เต็ม (เวกเตอร์ซูมได้ทุกระดับ)' : 'ซูมได้ถึงระดับ ' + p.z1}${S.layer === 'vec' ? '' : p.z1 >= 16 ? ' (เห็นถนนเล็ก ทางเดิน)' : p.z1 >= 14 ? ' (เห็นถนนและแหล่งน้ำ)' : ' (ภาพรวม)'}</b>
  <span>ขนาด</span><b>${p.urls.length} แผ่น ~${(p.urls.length * p.ly.kb / 1024).toFixed(1)} MB</b><span>เก็บไว้แล้ว</span><b id="offHave">${have} แผ่น</b></div>
  ${p.tooBig ? '<div class="warn">พื้นที่กว้างเกินไป ซูมเข้าให้แคบลงก่อนแล้วลองใหม่</div>' : p.z1 < Math.min(15, p.ly.maxZ) ? '<div class="warn">พื้นที่กว้าง เลยเก็บได้แค่ระดับภาพรวม ถ้าอยากเห็นละเอียด ให้ซูมเข้าไปที่จุดตกปลาแล้วกดเก็บอีกรอบ</div>' : ''}
  <div class="prog hidden" id="offProg"><i></i></div><div class="sub" id="offMsg">เก็บแผนที่ แหล่งน้ำ ระดับน้ำ และพยากรณ์ 14 วันของบริเวณนี้ในครั้งเดียว เก็บได้หลายรอบ ควรทำตอนต่อ Wi-Fi<span id="offUse"></span></div>
  <div class="row"><button class="btn acc" id="offGo" ${p.tooBig ? 'disabled' : ''}>ดาวน์โหลดบริเวณนี้</button><button class="btn ghost" id="offDel">ลบแผนที่ออฟไลน์ทั้งหมด</button></div>`);
  $('#offGo').onclick = async e => {
    if (OFF.running) { OFF.cancel = true; return; }
    OFF.running = true; OFF.cancel = false; e.target.textContent = 'หยุด'; $('#offProg').classList.remove('hidden');
    const cache = await caches.open('pranpla-offline'), q = p.urls.slice(); let done = 0, fail = 0;
    const worker = async () => { while (q.length && !OFF.cancel) { const u = q.shift(); try { if (!(await cache.match(u))) { const r = await fetch(u + '#dl'); if (!r.ok) throw 0; await cache.put(u, r); } } catch { fail++; } done++; const bar = $('#offProg i'); if (bar) { bar.style.width = (done / p.urls.length * 100) + '%'; $('#offMsg').textContent = `${done}/${p.urls.length} แผ่น${fail ? ` · พลาด ${fail}` : ''}`; } } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    let extra = '';
    if (!OFF.cancel) {   // เก็บข้อมูลอื่นของบริเวณนี้ไว้ด้วย: แหล่งน้ำ ระดับน้ำ พยากรณ์ของกลางจอและหมุดในจอ
      if ($('#offMsg')) $('#offMsg').textContent = 'กำลังเก็บแหล่งน้ำ ระดับน้ำ และพยากรณ์…';
      const bb = map.getBounds(), c = bb.getCenter(), pts = [{ lat: c.lat, lng: c.lng }].concat(S.spots.filter(s => bb.contains([s.lat, s.lng])).slice(0, 8));
      const [, D, ...fx] = await Promise.all([findWater(true), loadDams(), ...pts.map(wxPrefetch)]);
      extra = ` · แหล่งน้ำ ${(S.water || []).length} แห่ง · พยากรณ์ 14 วัน ${fx.filter(Boolean).length}/${pts.length} จุด${D ? ' · ระดับน้ำ' : ''}`;
    }
    OFF.running = false; const n = await offlineCount();
    if ($('#offMsg')) { $('#offMsg').textContent = OFF.cancel ? `หยุดแล้ว เก็บได้ ${done - fail} แผ่น` : fail ? `แผนที่พลาด ${fail} แผ่น กดดาวน์โหลดอีกครั้งเพื่อเก็บส่วนที่ขาด${extra}` : '✅ เก็บครบแล้ว บริเวณนี้เปิดได้โดยไม่ต้องมีเน็ต' + extra; $('#offHave').textContent = n + ' แผ่น'; $('#offGo').textContent = 'ดาวน์โหลดบริเวณนี้'; }
    else toast(fail ? `เก็บแผนที่เสร็จ พลาด ${fail} แผ่น` : 'เก็บแผนที่ออฟไลน์ครบแล้ว ✅');
  };
  navigator.storage?.estimate?.().then(e => { const el = $('#offUse'); if (el && e.usage) el.textContent = ` · ใช้พื้นที่ในเครื่อง ${(e.usage / 1048576).toFixed(0)} MB`; });
  let armed = false;
  $('#offDel').onclick = async e => { if (!armed) { armed = true; e.target.textContent = 'แตะอีกครั้งเพื่อลบ'; return; } await caches.delete('pranpla-offline'); $('#offHave').textContent = '0 แผ่น'; e.target.textContent = 'ลบแล้ว'; };
}

/* ============ วัดระยะ ============ */
const M = { on: false, pts: [] }, gMeasure = L.layerGroup().addTo(map);
function drawMeasure() {
  gMeasure.clearLayers(); let tot = 0;
  if (M.pts.length > 1) L.polyline(M.pts, { color: '#f43f5e', weight: 4 }).addTo(gMeasure);
  M.pts.forEach((p, i) => {
    if (i) tot += dist({ lat: M.pts[i - 1][0], lng: M.pts[i - 1][1] }, { lat: p[0], lng: p[1] });
    L.circleMarker(p, { radius: 6, color: '#fff', weight: 2, fillColor: '#f43f5e', fillOpacity: 1, interactive: false }).addTo(gMeasure);
    if (i) L.marker(p, { interactive: false, icon: L.divIcon({ className: '', html: `<div class="mlbl">${fmtDist(tot)}</div>`, iconSize: [80, 20], iconAnchor: [40, 30] }) }).addTo(gMeasure);
  });
  const n = M.pts.length, last = n > 1 ? bearing({ lat: M.pts[n - 2][0], lng: M.pts[n - 2][1] }, { lat: M.pts[n - 1][0], lng: M.pts[n - 1][1] }) : null;
  $('#measLabel').innerHTML = n < 2 ? (n ? 'แตะจุดถัดไป' : 'แตะแผนที่เพื่อวางจุดแรก') : `<b>${fmtDist(tot)}</b> · เดิน ~${durTxt(tot / 4000 * 36e5)} · ช่วงล่าสุดทิศ ${Math.round(last)}° ${dirE(last)}`;
}
function setMeasure(on) {
  M.on = on; M.pts = []; $('#btnMeasure').classList.toggle('on', on); $('#measBar').classList.toggle('hidden', !on); drawMeasure();
  if (on) toast('โหมดวัดระยะ: แตะแผนที่ทีละจุด');
}
map.on('click', e => { if (M.on) { M.pts.push([e.latlng.lat, e.latlng.lng]); drawMeasure(); } });
$('#btnMeasure').onclick = () => setMeasure(!M.on);
$('#measClose').onclick = () => setMeasure(false);
$('#measUndo').onclick = () => { M.pts.pop(); drawMeasure(); };
$('#measMe').onclick = () => { if (!S.pos) return toast('ยังไม่ได้ตำแหน่ง GPS'); M.pts.push([S.pos.lat, S.pos.lng]); drawMeasure(); };

/* ============ compass ============ */
function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h == null) return;
  h = (h + (screen.orientation?.angle || 0) + 360) % 360;
  if (S.heading != null && Math.abs(h - S.heading) < 2) return;
  S.heading = h; updateMe(); renderCompass();
}
function startCompass() {
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', onOrient, true);
}
if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
  $('#compassPerm').classList.remove('hidden');
  $('#compassPerm').onclick = () => DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') { startCompass(); $('#compassPerm').classList.add('hidden'); } });
} else startCompass();
(function ticks() {
  let h = '';
  for (let a = 0; a < 360; a += 15) h += `<line class="${a % 90 === 0 ? 'maj' : ''}" x1="100" y1="6" x2="100" y2="${a % 45 === 0 ? 18 : 12}" transform="rotate(${a} 100 100)"/>`;
  $('#ticks').innerHTML = h;
})();
function renderCompass() {
  const h = S.heading;
  $('#mcRose').style.transform = `rotate(${h == null ? 0 : -h}deg)`;
  $$('#compassDial .cdir, #mcRose .mc-t').forEach(t => t.setAttribute('transform', `rotate(${h || 0} ${t.getAttribute('x')} ${t.getAttribute('y') - (t.classList.contains('mc-t') ? 4 : 6)})`));   // ตัวอักษรทิศตั้งตรงเสมอ
  $('#mcDeg').textContent = h == null ? 'เข็มทิศ' : Math.round(h) + '° ' + dirE(h);
  const mt = $('#mcTarget');
  if (S.target && S.pos) { mt.classList.remove('hidden'); mt.style.transform = `rotate(${bearing(S.pos, S.target) - (h || 0)}deg)`; } else mt.classList.add('hidden');
  $('#compassDial').style.transform = `rotate(${h == null ? 0 : -h}deg)`;
  $('#headingDeg').textContent = h == null ? '---°' : Math.round(h) + '°';
  $('#headingTxt').textContent = h == null ? 'ไม่มีเซนเซอร์เข็มทิศ' : dirTxt(h);
  const ta = $('#targetArrow');
  if (S.target && S.pos) {
    const b = bearing(S.pos, S.target);
    ta.classList.remove('hidden'); ta.style.transform = `rotate(${b - (h || 0)}deg)`;
    $('#targetDist').textContent = fmtDist(dist(S.pos, S.target));
    $('#targetBear').textContent = Math.round(b) + '° ' + dirE(b);
  } else ta.classList.add('hidden');
}
function setTarget(t) {
  S.target = t; $('#targetBox').classList.toggle('hidden', !t);
  if (t) { $('#targetName').textContent = t.name; toast('นำทางไป: ' + t.name + ' — ลูกศรสีส้มชี้ทาง'); }
  updateMe(); renderCompass();
}
$('#targetClear').onclick = () => setTarget(null);

/* ============ sheets ============ */
let sheetHist = false;
function openSheet(html) {
  $('#sheet').innerHTML = '<div class="grab"></div><button class="sheet-x" data-act="close" aria-label="ปิด">✕</button>' + html;
  $('#sheet').classList.add('open'); $('#sheetBg').classList.remove('hidden'); $('#sheet').scrollTop = 0;
  if (!sheetHist) { try { history.pushState({ sheet: 1 }, ''); sheetHist = true; } catch {} }   // ให้ปุ่มย้อนกลับของมือถือปิดหน้าต่างนี้
}
function hideSheet() { $('#sheet').classList.remove('open'); $('#sheetBg').classList.add('hidden'); $('#crosshair').classList.toggle('hidden', !OPT.cross); }
function closeSheet() { hideSheet(); if (sheetHist) { sheetHist = false; try { history.back(); } catch {} } }
window.addEventListener('popstate', () => { if (sheetHist) { sheetHist = false; hideSheet(); } });
// ลากแถบบนลงเพื่อปิด
{ let y0 = null; const sh = $('#sheet');
  sh.addEventListener('touchstart', e => { y0 = sh.scrollTop <= 0 && e.touches[0].clientY - sh.getBoundingClientRect().top < 70 ? e.touches[0].clientY : null; }, { passive: true });
  sh.addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 70) closeSheet(); y0 = null; }, { passive: true }); }
$('#sheetBg').onclick = closeSheet;
function compressImage(file, max = 1100, q = .72) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}
function bindPhoto(root, holder) {
  $('[name=photo]', root).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { holder.photo = await compressImage(f); $('.photo-prev', root).src = holder.photo; $('.photo-prev', root).classList.remove('hidden'); }
    catch { toast('อ่านรูปไม่ได้'); }
  };
}

/* ---- FAB menu ---- */
$('#fab').onclick = () => openSheet(`
  <h3>อยากทำอะไร?</h3>
  <button class="menu-item" data-act="new-catch"><span class="mi">🐟</span><span><b>บันทึกปลาที่จับได้</b><span class="sub">ชนิด ขนาด เหยื่อ รูป พร้อมสภาพอากาศตอนนั้น</span></span></button>
  <button class="menu-item" data-act="new-spot-here"><span class="mi">📍</span><span><b>ปักหมุดตรงที่ฉันยืน</b><span class="sub">จุดตกปลา ที่จอดรถ แคมป์ จุดอันตราย</span></span></button>
  <button class="menu-item" data-act="new-spot-center"><span class="mi">🎯</span><span><b>ปักหมุดกลางแผนที่</b><span class="sub">เลื่อนแผนที่ให้กากบาทตรงจุด หรือกดค้างบนแผนที่</span></span></button>
  <button class="menu-item" data-act="toggle-track"><span class="mi">👣</span><span><b>${S.track.on ? 'หยุดบันทึกเส้นทาง' : 'เริ่มบันทึกเส้นทางเดิน'}</b><span class="sub">ไว้เดินย้อนกลับจุดเริ่มต้น</span></span></button>
  <button class="menu-item" data-act="find-water"><span class="mi">💧</span><span><b>หาแหล่งน้ำรอบแผนที่</b><span class="sub">หนอง บึง อ่าง แม่น้ำ จากฐานข้อมูล OpenStreetMap</span></span></button>`);

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === 'new-catch') catchForm();
  else if (a === 'new-spot-here') { if (!S.pos) return toast('ยังไม่ได้ตำแหน่ง GPS ลองปักหมุดกลางแผนที่แทน'); spotForm({ lat: S.pos.lat, lng: S.pos.lng }); }
  else if (a === 'new-spot-center') { closeSheet(); showTab('map'); const c = map.getCenter(); spotForm({ lat: c.lat, lng: c.lng }); $('#crosshair').classList.remove('hidden'); updateCross(); }
  else if (a === 'toggle-track') { closeSheet(); toggleTrack(); }
  else if (a === 'find-water') { closeSheet(); showTab('map'); findWater(); }
  else if (a === 'close') closeSheet();
  else if (a === 'spot') spotSheet(id);
  else if (a === 'catch') catchSheet(id);
});

/* ---- spots ---- */
function spotForm(init) {
  const ex = init.id ? S.spots.find(s => s.id === init.id) : null;
  const d = ex ? { fee: '', hours: '', rules: '', tel: '', ...ex } : { id: uid(), type: 'fish', name: '', note: '', fish: '', fee: '', hours: '', rules: '', tel: '', photo: null, created: Date.now(), ...init };
  openSheet(`<h3>${ex ? 'แก้ไขหมุด' : 'ปักหมุดใหม่'}</h3>
  <div class="sub mono">${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}</div>
  <div class="form">
    <label>ประเภท</label>
    <div class="types">${Object.entries(SPOT_TYPES).map(([k, t]) => `<button type="button" data-type="${k}" class="${k === d.type ? 'sel' : ''}">${t.icon} ${t.label}</button>`).join('')}</div>
    <label>ชื่อจุด</label><input name="name" value="${esc(d.name)}" placeholder="เช่น หนองบัว ฝั่งตอไม้">
    <label>ปลาที่เจอ</label><input name="fish" value="${esc(d.fish)}" placeholder="ช่อน ชะโด นิล…">
    <label>โน้ต</label><textarea name="note" placeholder="ทางเข้า ความลึก เหยื่อที่ได้ผล ข้อควรระวัง">${esc(d.note)}</textarea>
    <div class="two"><div><label>ค่าบริการ / ค่าบ่อ</label><input name="fee" value="${esc(d.fee)}" placeholder="ฟรี, 100 บ./วัน"></div>
    <div><label>เวลาเปิด–ปิด</label><input name="hours" value="${esc(d.hours)}" placeholder="06:00–18:00"></div></div>
    <label>กฎ / ข้อห้าม</label><input name="rules" value="${esc(d.rules)}" placeholder="ห้ามเหยื่อสด, ปล่อยปลาเล็ก, ขออนุญาตเจ้าของ">
    <label>เบอร์ติดต่อ</label><input name="tel" type="tel" value="${esc(d.tel)}" placeholder="เจ้าของบ่อ / ผู้ดูแล">
    <label>รูป</label><input name="photo" type="file" accept="image/*">
    <img class="photo-prev ${d.photo ? '' : 'hidden'}" src="${d.photo || ''}">
    <div class="row"><button class="btn block acc" id="spSave">บันทึกหมุด</button></div>
  </div>`);
  const r = $('#sheet');
  $$('.types button', r).forEach(b => b.onclick = () => { d.type = b.dataset.type; $$('.types button', r).forEach(x => x.classList.toggle('sel', x === b)); });
  bindPhoto(r, d);
  $('#spSave').onclick = () => {
    d.name = $('[name=name]', r).value.trim() || SPOT_TYPES[d.type].label;
    ['fish', 'note', 'fee', 'hours', 'rules', 'tel'].forEach(k => d[k] = $(`[name=${k}]`, r).value.trim());
    const i = S.spots.findIndex(s => s.id === d.id);
    if (i >= 0) S.spots[i] = d; else S.spots.push(d);
    save('spots'); renderSpots(); renderLog(); closeSheet(); toast('บันทึกหมุดแล้ว');
  };
}
const svUrl = p => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${(+p.lat).toFixed(6)},${(+p.lng).toFixed(6)}`;
const svBtn = p => `<a class="btn ghost" href="${svUrl(p)}" target="_blank" rel="noopener">🚶 ภาพถนน</a>`;
function gmaps(p) { return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`; }
function spotSheet(id) {
  const s = S.spots.find(x => x.id === id); if (!s) return;
  const t = SPOT_TYPES[s.type] || SPOT_TYPES.other, n = S.catches.filter(c => c.spotId === id).length;
  openSheet(`<h3>${t.icon} ${esc(s.name)}</h3>
  <div class="sub">${t.label}${S.pos ? ' · ห่าง ' + fmtDist(dist(S.pos, s)) : ''}</div>
  ${s.photo ? `<img class="photo-prev" src="${s.photo}">` : ''}
  <div class="kv"><span>พิกัด</span><b class="mono">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</b>
    ${s.fish ? `<span>ปลา</span><b>${esc(s.fish)}</b>` : ''}${s.note ? `<span>โน้ต</span><b>${esc(s.note)}</b>` : ''}
    ${s.fee ? `<span>ค่าบริการ</span><b>${esc(s.fee)}</b>` : ''}${s.hours ? `<span>เปิด–ปิด</span><b>${esc(s.hours)}</b>` : ''}${s.rules ? `<span>กฎ/ข้อห้าม</span><b style="color:var(--warn-tx)">⚠️ ${esc(s.rules)}</b>` : ''}${s.tel ? `<span>ติดต่อ</span><b><a href="tel:${esc(s.tel.replace(/[^0-9+]/g, ''))}" style="color:var(--link)">${esc(s.tel)}</a></b>` : ''}
    <span>ปลาที่บันทึก</span><b>${n} ตัว</b></div>
  <div id="spDam"></div>
  <div class="row">
    <button class="btn acc" id="spNav">🧭 นำทางด้วยเข็มทิศ</button>
    <a class="btn ghost" href="${gmaps(s)}" target="_blank" rel="noopener">Google Maps</a>
    ${svBtn(s)}
    <button class="btn ghost" id="spFc">🌤️ พยากรณ์ที่นี่</button>
    <button class="btn ghost" id="spCatch">🐟 บันทึกปลาที่นี่</button>
    <button class="btn ghost" id="spShare">📤 แชร์หมุด</button>
    <button class="btn ghost" id="spEdit">แก้ไข</button>
    <button class="btn danger" id="spDel">ลบ</button>
  </div>`);
  $('#spNav').onclick = () => { setTarget({ lat: s.lat, lng: s.lng, name: s.name }); closeSheet(); showTab('tools'); };
  $('#spFc').onclick = () => { closeSheet(); loadForecast({ lat: s.lat, lng: s.lng, name: s.name }); showTab('forecast'); };
  $('#spCatch').onclick = () => catchForm({ spotId: s.id });
  $('#spEdit').onclick = () => spotForm({ id: s.id });
  $('#spShare').onclick = () => shareSpot(s);
  damNear(s, 4000).then(h => { const el = $('#spDam'); if (el && h) el.innerHTML = h; });
  let armed = false;
  $('#spDel').onclick = e => {
    if (!armed) { armed = true; e.target.textContent = 'แตะอีกครั้งเพื่อลบ'; return; }
    S.spots = S.spots.filter(x => x.id !== id); save('spots'); renderSpots(); renderLog(); closeSheet(); toast('ลบหมุดแล้ว');
  };
  map.panTo([s.lat, s.lng]);
}

/* ---- catches ---- */
function wxSnap() {
  const w = S.wx; if (!w || !w.now) return null;
  return { dp: w.now.dp, rain: w.now.rain, temp: w.now.temp, pres: w.now.pres, wind: w.now.wind, code: w.now.code, score: w.now.score, place: S.fcLoc?.name };
}
function catchForm(init = {}) {
  const editing = !!init.id;
  const d = { id: uid(), t: Date.now(), species: '', len: '', wt: '', bait: '', note: '', photo: null, released: false, spotId: '', ...init };
  const now = new Date(d.t - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  openSheet(`<h3>${editing ? 'แก้ไขบันทึกปลา' : 'บันทึกปลาที่จับได้'}</h3>
  <div class="form">
    <label>ชนิดปลา</label><input name="species" list="fishList" placeholder="เช่น ปลาช่อน" value="${esc(d.species)}">
    <datalist id="fishList">${FISH.map(f => `<option value="${f.n}">`).join('')}</datalist>
    <div class="two"><div><label>ยาว (ซม.)</label><input name="len" type="number" inputmode="decimal" step="0.1" value="${d.len ?? ''}"></div>
    <div><label>หนัก (กก.)</label><input name="wt" type="number" inputmode="decimal" step="0.01" value="${d.wt ?? ''}"></div></div>
    <label>เหยื่อ / วิธีตก</label><input name="bait" placeholder="กบยาง, ไส้เดือน, ตกทุ่น…" value="${esc(d.bait)}">
    <label>จุดที่ได้</label><select name="spot"><option value="">ตำแหน่งปัจจุบัน (GPS)</option>${S.spots.map(s => `<option value="${s.id}" ${s.id === d.spotId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <label>เวลา</label><input name="t" type="datetime-local" value="${now}">
    <label>รูปปลา</label><input name="photo" type="file" accept="image/*">
    <img class="photo-prev ${d.photo ? '' : 'hidden'}" src="${d.photo || ''}">
    <label>โน้ต</label><textarea name="note">${esc(d.note)}</textarea>
    <label style="display:flex;gap:8px;align-items:center;color:var(--tx)"><input name="rel" type="checkbox" style="width:auto" ${d.released ? 'checked' : ''}> ปล่อยคืนน้ำ</label>
    <div class="row"><button class="btn block acc" id="ctSave">บันทึก</button></div>
  </div>`);
  const r = $('#sheet'); bindPhoto(r, d);
  $('#ctSave').onclick = () => {
    const v = n => $(`[name=${n}]`, r).value.trim();
    d.species = v('species') || 'ไม่ระบุชนิด'; d.len = parseFloat(v('len')) || null; d.wt = parseFloat(v('wt')) || null;
    d.bait = v('bait'); d.note = v('note'); d.released = $('[name=rel]', r).checked; d.spotId = v('spot');
    d.t = v('t') ? new Date(v('t')).getTime() : Date.now();
    const sp = S.spots.find(s => s.id === d.spotId);
    if (sp) { d.lat = sp.lat; d.lng = sp.lng; } else if (S.pos && !editing) { d.lat = S.pos.lat; d.lng = S.pos.lng; }
    if (editing) { const i = S.catches.findIndex(x => x.id === d.id); if (i >= 0) S.catches[i] = d; S.catches.sort((x, y) => y.t - x.t); save('catches'); renderLog(); closeSheet(); toast('แก้ไขแล้ว'); return; }
    if (Math.abs(Date.now() - d.t) < 2 * 36e5 && S.fcLoc && (d.lat == null || dist(S.fcLoc, d) < 25000)) d.wx = wxSnap();
    d.moon = SunCalc.getMoonIllumination(new Date(d.t)).phase;
    S.catches.unshift(d); save('catches'); renderLog(); closeSheet(); toast('บันทึกปลาแล้ว 🎣');
  };
}
function catchSheet(id) {
  const c = S.catches.find(x => x.id === id); if (!c) return;
  const sp = S.spots.find(s => s.id === c.spotId), dt = new Date(c.t);
  openSheet(`<h3>🐟 ${esc(c.species)}</h3>
  <div class="sub">${dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} ${hm(dt)}${c.released ? ' · ปล่อยคืนน้ำ' : ''}</div>
  ${c.photo ? `<img class="photo-prev" src="${c.photo}">` : ''}
  <div class="kv">
    ${c.len ? `<span>ยาว</span><b>${c.len} ซม.</b>` : ''}${c.wt ? `<span>หนัก</span><b>${c.wt} กก.</b>` : ''}
    ${c.bait ? `<span>เหยื่อ</span><b>${esc(c.bait)}</b>` : ''}
    <span>จุด</span><b>${sp ? esc(sp.name) : c.lat ? `<span class="mono">${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</span>` : '-'}</b>
    ${c.wx ? `<span>อากาศ</span><b>${Math.round(c.wx.temp)}° · ${Math.round(c.wx.pres)} hPa · ลม ${Math.round(c.wx.wind)} กม./ชม. · คะแนน ${c.wx.score}</b>` : ''}
    <span>ดวงจันทร์</span><b>${moonName(c.moon ?? 0)}</b>
    ${c.note ? `<span>โน้ต</span><b>${esc(c.note)}</b>` : ''}
  </div>
  <div class="row"><button class="btn ghost" id="ctEdit">แก้ไข</button><button class="btn danger" id="ctDel">ลบรายการนี้</button></div>`);
  $('#ctEdit').onclick = () => catchForm({ ...c });
  let armed = false;
  $('#ctDel').onclick = e => {
    if (!armed) { armed = true; e.target.textContent = 'แตะอีกครั้งเพื่อลบ'; return; }
    S.catches = S.catches.filter(x => x.id !== id); save('catches'); renderLog(); closeSheet();
  };
}

/* ============ track ============ */
let wakeLock = null;
const ptsLen = p => { let d = 0; for (let i = 1; i < p.length; i++) d += dist({ lat: p[i - 1][0], lng: p[i - 1][1] }, { lat: p[i][0], lng: p[i][1] }); return d; };
const trackLen = () => ptsLen(S.track.pts);
const trkDate = t => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' ' + hm(new Date(t));
function archiveTrack() {   // เก็บเส้นทางปัจจุบันเข้าประวัติ (อัปเดตรายการเดิมถ้าเป็นการเดินต่อ)
  const t = S.track; if (!t.pts || t.pts.length < 2) return;
  const rec = { id: t.id || uid(), name: t.name || 'เส้นทาง ' + trkDate(t.started || Date.now()), started: t.started || t.pts[0][2] || Date.now(), ended: Date.now(), pts: t.pts.slice(), len: Math.round(ptsLen(t.pts)) };
  t.id = rec.id; t.name = rec.name;
  const i = S.tracks.findIndex(x => x.id === rec.id); if (i >= 0) S.tracks[i] = rec; else S.tracks.unshift(rec);
  save('tracks');
}
async function toggleTrack(resumeId) {
  if (!S.track.on) {
    const r = typeof resumeId === 'string' ? S.tracks.find(x => x.id === resumeId) : null;
    S.track = r ? { on: true, id: r.id, name: r.name, started: r.started, pts: r.pts.slice() } : { on: true, id: uid(), name: '', started: Date.now(), pts: [] };
    trackLine.setLatLngs(S.track.pts.map(p => [p[0], p[1]]));
    if (S.pos) { S.track.pts.push([+S.pos.lat.toFixed(6), +S.pos.lng.toFixed(6), Date.now()]); trackLine.addLatLng([S.pos.lat, S.pos.lng]); }
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    toast((r ? 'เดินต่อจากเส้นทางเดิม' : 'เริ่มบันทึกเส้นทาง') + ' — เปิดจอแอปค้างไว้ระหว่างเดิน', 4000);
  } else {
    S.track.on = false; try { await wakeLock?.release(); } catch {} wakeLock = null; archiveTrack();
    toast(S.track.pts.length < 2 ? 'หยุดแล้ว (สั้นเกินไป ไม่ได้เก็บเข้าประวัติ)' : `หยุดแล้ว ${fmtDist(trackLen())} — เก็บไว้ในประวัติเส้นทางที่แท็บบันทึก`, 4000);
  }
  save('track'); renderTrackUI();
}
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && S.track.on) { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} } });
function renderTrackUI() {
  $('#btnTrack').classList.toggle('on', S.track.on); $('#trackLabel').textContent = S.track.on ? 'กำลังอัด' : 'เส้นทาง';
  const p = S.track.pts || [];
  $('#trackInfo').innerHTML = (S.track.on ? `<div class="kv"><span>สถานะ</span><b>🔴 กำลังบันทึก</b><span>ระยะทาง</span><b>${fmtDist(trackLen())}</b>${p.length ? `<span>จุดเริ่ม</span><b class="mono">${p[0][0].toFixed(5)}, ${p[0][1].toFixed(5)}</b>` : ''}</div>
    <div class="row"><button class="btn small acc" id="trkBack">↩️ นำทางกลับจุดเริ่ม</button><button class="btn small ghost" id="trkToggle">หยุดและเก็บ</button></div>`
    : `<div class="sub">กดปุ่มเส้นทางบนแผนที่ก่อนเดินเข้าป่า/ริมน้ำ แอปจะลากเส้นที่เดิน พอกดหยุดจะเก็บเข้าประวัติด้านล่าง เปิดดูหรือเดินต่อได้</div><div class="row"><button class="btn small" id="trkToggle">เริ่มเส้นทางใหม่</button></div>`)
    + (S.tracks.length ? `<div class="card-h" style="margin-top:14px;font-size:15px">ประวัติเส้นทาง (${S.tracks.length})</div>` + S.tracks.map(t => `<div class="trk" data-trk="${t.id}"><div><b>${esc(t.name)}</b><div class="sub">${trkDate(t.started)} · ${fmtDist(t.len)} · ${durTxt(Math.max(0, (t.ended || t.started) - t.started))}</div></div><span>›</span></div>`).join('') : '');
  $('#trkToggle').onclick = () => toggleTrack();
  if ($('#trkBack')) $('#trkBack').onclick = returnToStart;
  $$('#trackInfo [data-trk]').forEach(el => el.onclick = () => trackSheet(el.dataset.trk));
}
function showTrackOnMap(t) {
  trackLine.setLatLngs(t.pts.map(p => [p[0], p[1]])); S.follow = false; $('#btnLocate').classList.remove('follow');
  showTab('map'); setTimeout(() => { try { map.fitBounds(trackLine.getBounds().pad(.2), { maxZoom: 17 }); } catch {} }, 80);
}
function trackSheet(id) {
  const t = S.tracks.find(x => x.id === id); if (!t) return;
  const a = t.pts[0], b = t.pts[t.pts.length - 1];
  openSheet(`<h3>👣 เส้นทาง</h3>
  <div class="form"><label>ชื่อ</label><input id="trkName" value="${esc(t.name)}"></div>
  <div class="kv"><span>เริ่ม</span><b>${trkDate(t.started)}</b><span>ระยะทาง</span><b>${fmtDist(t.len)}</b><span>ใช้เวลา</span><b>${durTxt(Math.max(0, (t.ended || t.started) - t.started))}</b>
  <span>จุดเริ่ม</span><b class="mono">${a[0].toFixed(5)}, ${a[1].toFixed(5)}</b><span>จุดสิ้นสุด</span><b class="mono">${b[0].toFixed(5)}, ${b[1].toFixed(5)}</b>${S.pos ? `<span>ปลายทางห่างฉัน</span><b>${fmtDist(dist(S.pos, { lat: b[0], lng: b[1] }))}</b>` : ''}</div>
  <div class="row">
    <button class="btn acc" id="trkShow">🗺️ ดูบนแผนที่</button>
    <button class="btn ghost" id="trkResume">👣 เดินต่อจากเส้นนี้</button>
    <button class="btn ghost" id="trkToStart">↩️ นำทางไปจุดเริ่ม</button>
    <button class="btn ghost" id="trkToEnd">🎯 นำทางไปจุดสิ้นสุด</button>
    <button class="btn danger" id="trkDel">ลบ</button>
  </div>`);
  $('#trkName').onchange = e => { t.name = e.target.value.trim() || t.name; if (S.track.id === t.id) S.track.name = t.name; save('tracks'); renderTrackUI(); };
  $('#trkShow').onclick = () => { closeSheet(); showTrackOnMap(t); };
  $('#trkResume').onclick = async () => { if (S.track.on) return toast('กำลังบันทึกอีกเส้นอยู่ กดหยุดก่อน'); closeSheet(); await toggleTrack(t.id); showTrackOnMap(S.track); };
  $('#trkToStart').onclick = () => { setTarget({ lat: a[0], lng: a[1], name: 'จุดเริ่ม: ' + t.name }); closeSheet(); showTab('tools'); };
  $('#trkToEnd').onclick = () => { setTarget({ lat: b[0], lng: b[1], name: 'ปลายทาง: ' + t.name }); closeSheet(); showTab('tools'); };
  let armed = false;
  $('#trkDel').onclick = e => { if (!armed) { armed = true; e.target.textContent = 'แตะอีกครั้งเพื่อลบ'; return; } S.tracks = S.tracks.filter(x => x.id !== id); save('tracks'); if (S.track.id === id && !S.track.on) { S.track = { on: false, pts: [] }; trackLine.setLatLngs([]); save('track'); } renderTrackUI(); closeSheet(); };
}
function returnToStart() {
  const p = S.track.pts; if (!p.length) return toast('ยังไม่มีเส้นทางที่บันทึก');
  setTarget({ lat: p[0][0], lng: p[0][1], name: 'จุดเริ่มต้นเส้นทาง' }); showTab('tools');
}
$('#btnTrack').onclick = () => toggleTrack();
$('#tReturn').onclick = returnToStart;

/* ============ water bodies (Overpass) ============ */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let waterC = null;
async function waterAll() { if (!waterC) { try { waterC = (await DB.get('water')) || []; } catch { waterC = []; } } return waterC; }
async function waterKeep(list) {
  const all = await waterAll(), key = w => (w.name || '') + '|' + w.lat.toFixed(4) + ',' + w.lng.toFixed(4), have = new Set(all.map(key));
  list.forEach(w => { if (!have.has(key(w))) all.push({ lat: w.lat, lng: w.lng, name: w.name, kind: w.kind, fishing: w.fishing }); });
  if (all.length > 3000) all.splice(0, all.length - 3000);
  DB.set('water', all).catch(() => {});
}
function drawWater(list) {
  list.forEach(w => L.marker([w.lat, w.lng], {
    icon: L.divIcon({ className: '', html: `<div class="wmk"><i style="${w.fishing ? 'background:#f59e0b' : ''}">${w.fishing ? '🎣' : '💧'}</i>${w.name ? `<b>${esc(w.name)}</b>` : ''}</div>`, iconSize: [120, 44], iconAnchor: [60, 14] })
  }).on('click', () => waterSheet(w)).addTo(gWater));
}
async function findWater(silent) {
  silent = silent === true;
  const c = map.getCenter(), b = map.getBounds();
  const r = Math.round(clamp(dist({ lat: c.lat, lng: c.lng }, { lat: b.getNorth(), lng: c.lng }) * 1.3, 800, 9000));
  const ar = `(around:${r},${c.lat.toFixed(5)},${c.lng.toFixed(5)})`;
  const q = `[out:json][timeout:25];(nwr["natural"="water"]${ar};nwr["landuse"="reservoir"]${ar};nwr["leisure"="fishing"]${ar};nwr["waterway"~"^(river|canal|stream)$"]["name"]${ar};);out center tags 400;`;
  silent || toast('กำลังค้นหาแหล่งน้ำในรัศมี ' + fmtDist(r) + '…', 8000);
  let data = null;
  for (const u of navigator.onLine === false ? [] : OVERPASS) {
    try { const res = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); if (res.ok) { data = JSON.parse(await res.text()); break; } } catch {}
  }
  gWater.clearLayers();
  loadDams().then(D => { if (!D) return; D.list.filter(x => dist({ lat: c.lat, lng: c.lng }, x) <= r * 1.5).forEach(x => L.marker([x.lat, x.lng], { zIndexOffset: 500, icon: L.divIcon({ className: '', html: `<div class="wmk"><i style="background:${damColor(x.pct)};width:38px;height:38px;font-size:11px;font-weight:700;color:#fff">${x.pct.toFixed(0)}%</i><b>${esc(x.n)}</b></div>`, iconSize: [140, 56], iconAnchor: [70, 19] }) }).on('click', () => waterSheet({ lat: x.lat, lng: x.lng, name: x.n, kind: x.type === 'L' ? 'เขื่อนขนาดใหญ่' : x.type === 'M' ? 'อ่างเก็บน้ำขนาดกลาง' : 'อ่างเก็บน้ำขนาดเล็ก' })).addTo(gWater)); });
  if (!data) {   // ออฟไลน์/เซิร์ฟเวอร์ล่ม: ใช้แหล่งน้ำที่เคยโหลดเก็บไว้
    const all = await waterAll(), list = all.map(w => ({ ...w, d: dist({ lat: c.lat, lng: c.lng }, w) })).filter(w => w.d <= r * 1.3).sort((p, q) => p.d - q.d).slice(0, 150);
    S.water = list; drawWater(list);
    return silent || toast(list.length ? `ออฟไลน์: แสดงแหล่งน้ำที่เก็บไว้ ${list.length} แห่ง` : 'ไม่มีเน็ต และยังไม่เคยโหลดแหล่งน้ำบริเวณนี้ไว้', 4500);
  }
  const seen = new Set(), out = [];
  for (const e of data.elements || []) {
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon; if (lat == null) continue;
    const tg = e.tags || {}, name = tg['name:th'] || tg.name || '';
    const kind = tg.leisure === 'fishing' ? 'บ่อ/จุดตกปลา' : tg.waterway ? ({ river: 'แม่น้ำ', canal: 'คลอง', stream: 'ลำห้วย' }[tg.waterway]) : ({ reservoir: 'อ่างเก็บน้ำ', pond: 'บ่อ/สระ', lake: 'ทะเลสาบ/หนอง', river: 'แม่น้ำ', canal: 'คลอง', basin: 'แก้มลิง' }[tg.water] || 'แหล่งน้ำ');
    if (['swimming_pool', 'wastewater', 'fountain', 'reflecting_pool'].includes(tg.water)) continue;
    const key = name ? name + (tg.waterway ? '' : '|' + lat.toFixed(2) + lng.toFixed(2)) : lat.toFixed(4) + lng.toFixed(4);
    if (seen.has(key)) continue; seen.add(key);
    out.push({ lat, lng, name, kind, fishing: tg.leisure === 'fishing', d: dist({ lat: c.lat, lng: c.lng }, { lat, lng }) });
  }
  out.sort((a, b) => (b.fishing - a.fishing) || (!!b.name - !!a.name) || a.d - b.d);
  const list = out.slice(0, 120); S.water = list;
  drawWater(list); waterKeep(list);
  silent || toast(list.length ? `เจอแหล่งน้ำ ${list.length} แห่ง แตะหมุดเพื่อดูรายละเอียด` : 'ไม่พบแหล่งน้ำในบริเวณนี้ ลองซูมออกแล้วค้นใหม่');
}
function waterSheet(w) {
  const nm = w.name || w.kind + ' (ไม่มีชื่อ)';
  openSheet(`<h3>💧 ${esc(nm)}</h3><div class="sub">${w.kind}${S.pos ? ' · ห่าง ' + fmtDist(dist(S.pos, w)) : ''}</div>
  <div class="kv"><span>พิกัด</span><b class="mono">${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}</b></div>
  <div id="spDam"></div>
  <div class="warn">ข้อมูลจากแผนที่ชุมชน OSM ยังไม่ยืนยันว่าตกปลาได้ ตรวจสอบว่าเป็นที่สาธารณะหรือขออนุญาตเจ้าของก่อน</div>
  <div class="row">
    <button class="btn acc" id="wSave">📍 บันทึกเป็นจุดของฉัน</button>
    <button class="btn ghost" id="wFc">🌤️ พยากรณ์ที่นี่</button>
    <button class="btn ghost" id="wNav">🧭 นำทางด้วยเข็มทิศ</button>
    <a class="btn ghost" href="${gmaps(w)}" target="_blank" rel="noopener">Google Maps</a>
    ${svBtn(w)}
  </div>`);
  damNear(w, 4000).then(h => { const el = $('#spDam'); if (el && h) el.innerHTML = h; });
  $('#wSave').onclick = () => spotForm({ lat: w.lat, lng: w.lng, name: w.name || '', type: 'fish' });
  $('#wFc').onclick = () => { closeSheet(); loadForecast({ lat: w.lat, lng: w.lng, name: nm }); showTab('forecast'); };
  $('#wNav').onclick = () => { setTarget({ lat: w.lat, lng: w.lng, name: nm }); closeSheet(); showTab('tools'); };
}
$('#btnWater').onclick = () => findWater();

/* ============ ระดับน้ำเขื่อน/อ่าง (คลังข้อมูลน้ำแห่งชาติ thaiwater.net) ============ */
let damMem = null, damPromise = null;
async function loadDams() {
  const c = damMem || ls.get('dams'); if (c && Date.now() - c.t < 6 * 36e5) return damMem = c;
  if (damPromise) return damPromise;
  return damPromise = (async () => {
    try {
      const d = (await (await fetch('https://api-v3.thaiwater.net/api/v1/thaiwater30/analyst/dam')).json()).data, list = [];
      const add = (arr, type, f) => (arr || []).forEach(x => { try { const o = f(x); if (o.n && o.lat && o.lng && o.pct != null) list.push({ ...o, type, pct: +(+o.pct).toFixed(1), date: String(o.date).slice(0, 10) }); } catch {} });
      add(d.dam_daily, 'L', x => ({ n: 'เขื่อน' + x.dam.dam_name.th, lat: x.dam.dam_lat, lng: x.dam.dam_long, pct: x.dam_storage_percent, vol: x.dam_storage, cap: x.dam.normal_storage, date: x.dam_date }));
      add(d.dam_medium, 'M', x => ({ n: x.dam.dam_name.th, lat: x.dam.dam_lat, lng: x.dam.dam_long, pct: x.dam_storage_percent, vol: x.dam_storage, cap: x.dam.normal_storage, date: x.dam_date }));
      add(d.dam_small_tele, 'S', x => ({ n: x.dam.smalldam_name.th, lat: x.dam.tele_station_lat, lng: x.dam.tele_station_long, pct: x.percent_storage, vol: x.volume, cap: x.dam.normal_storage, date: x.smalldam_datetime }));
      if (!list.length) throw 0;
      const fresh = list.filter(x => Date.now() - new Date(x.date).getTime() < 10 * 864e5);
      const old = ls.get('dams'); let prev = ls.get('damPrev');
      const day = fresh.map(x => x.date).sort().pop();
      if (old && old.day && old.day !== day) { prev = { day: old.day, pct: Object.fromEntries(old.list.map(x => [x.n, x.pct])) }; ls.set('damPrev', prev); }
      damMem = { t: Date.now(), day, list: fresh }; ls.set('dams', damMem); return damMem;
    } catch { return damMem = c || null; } finally { damPromise = null; }
  })();
}
const damColor = p => p >= 100 ? '#3b82f6' : p >= 80 ? '#22c55e' : p >= 50 ? '#a3b14b' : p >= 30 ? '#f59e0b' : '#ef4444';
function damRow(x, from) {
  const prev = ls.get('damPrev'), p0 = prev?.pct?.[x.n], dl = p0 != null ? x.pct - p0 : null;
  const tr = dl == null ? '' : Math.abs(dl) < 0.05 ? ' · ทรงตัว' : ` · ${dl > 0 ? '▲ +' : '▼ '}${dl.toFixed(1)}% จาก ${prev.day.slice(5)}`;
  return `<div class="dam"><div class="dam-h"><b>${esc(x.n)}</b><span class="mono" style="color:${damColor(x.pct)}">${x.pct.toFixed(0)}%</span></div>
    <div class="track"><i style="width:${clamp(x.pct, 0, 100)}%;background:${damColor(x.pct)}"></i></div>
    <div class="sub">${x.vol != null ? (+x.vol).toFixed(x.vol < 10 ? 2 : 0) + (x.cap ? ' / ' + (+x.cap).toFixed(x.cap < 10 ? 2 : 0) : '') + ' ล้าน ลบ.ม.' : ''}${from ? ' · ห่าง ' + fmtDist(dist(from, x)) : ''} · ${x.date.slice(5)}${tr}</div></div>`;
}
async function damNear(p, maxM) {
  const D = await loadDams(); if (!D) return '';
  const x = D.list.map(d => ({ ...d, d: dist(p, d) })).filter(d => d.d <= maxM).sort((a, b) => a.d - b.d)[0];
  return x ? `<div class="card" style="margin:10px 0 0"><div class="card-h">🌊 ระดับน้ำ</div>${damRow(x)}</div>` : '';
}
async function renderDamCard() {
  const el = $('#damCard'), loc = S.fcLoc; if (!el || !loc) return;
  const D = await loadDams(); if (!$('#damCard')) return;
  if (!D) { el.innerHTML = '<div class="card-h">🌊 ระดับน้ำเขื่อน/อ่างใกล้ที่นี่</div><div class="sub">โหลดข้อมูลระดับน้ำไม่ได้ (ต้องต่อเน็ต)</div>'; return; }
  const near = D.list.map(d => ({ ...d, d: dist(loc, d) })).filter(d => d.d < 60000).sort((a, b) => a.d - b.d).slice(0, 5);
  $('#damCard').innerHTML = `<div class="card-h">🌊 ระดับน้ำเขื่อน/อ่างใกล้ที่นี่</div>${near.length ? near.map(x => damRow(x, loc)).join('') : '<div class="sub">ไม่มีเขื่อนหรืออ่างที่มีการรายงานระดับน้ำในรัศมี 60 กม.</div>'}
    <div class="sub" style="margin-top:8px">% ของความจุปกติ · หลักทั่วไป: น้ำขึ้นเร็วปลามักกระจายเข้าชายตื้นและน้ำใหม่ น้ำลดปลามักรวมตัวตามร่องน้ำลึก · ข้อมูล: คลังข้อมูลน้ำแห่งชาติ (thaiwater.net) รายงานวันละครั้ง${ls.get('damPrev') ? '' : ' · แนวโน้มขึ้น/ลงจะแสดงเมื่อเปิดแอปข้ามวัน'}</div>`;
}

/* ============ แชร์หมุด / รับหมุดจากลิงก์ ============ */
async function shareSpot(s) {
  const t = SPOT_TYPES[s.type] || SPOT_TYPES.other, ll = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
  const link = `${location.origin}${location.pathname}#pin=${ll},${s.type},${encodeURIComponent(s.name)}`;
  const text = [`${t.icon} ${s.name} (${t.label})`, s.fish && 'ปลา: ' + s.fish, s.fee && 'ค่าบริการ: ' + s.fee, s.hours && 'เวลา: ' + s.hours, s.rules && 'กฎ: ' + s.rules, `พิกัด: ${ll}`, `Google Maps: https://maps.google.com/?q=${ll}`, `เปิดในพรานปลา: ${link}`].filter(Boolean).join('\n');
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copy(text, 'คัดลอกข้อมูลหมุดแล้ว นำไปวางใน LINE ได้เลย');
}
function importPinFromHash() {
  const m = decodeURIComponent(location.hash).match(/^#pin=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),([a-z]+),(.*)$/); if (!m) return;
  history.replaceState(null, '', location.pathname);
  const lat = +m[1], lng = +m[2]; if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  S.follow = false; $('#btnLocate').classList.remove('follow'); S.noCenter = true; map.setView([lat, lng], 15);
  spotForm({ lat, lng, type: SPOT_TYPES[m[3]] ? m[3] : 'fish', name: m[4].slice(0, 80) }); toast('หมุดที่เพื่อนแชร์มา ตรวจแล้วกดบันทึกหมุด');
}
window.addEventListener('hashchange', importPinFromHash);

/* ============ place search: จุดของฉัน + แหล่งน้ำที่โหลดไว้ + Nominatim (ใกล้ก่อน) + Photon ============ */
const KIND_TH = { water: 'แหล่งน้ำ', reservoir: 'อ่างเก็บน้ำ', river: 'แม่น้ำ', stream: 'ลำห้วย', canal: 'คลอง', lake: 'ทะเลสาบ', pond: 'บ่อ/สระ', dam: 'เขื่อน', village: 'หมู่บ้าน', hamlet: 'หมู่บ้าน', town: 'เมือง', city: 'เมือง', suburb: 'ย่าน', administrative: 'เขตปกครอง', fishing: 'บ่อตกปลา', peak: 'ยอดเขา', waterfall: 'น้ำตก', national_park: 'อุทยาน', temple: 'วัด', place_of_worship: 'วัด/ศาสนสถาน' };
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
function closeSearch() { $('#searchResults').classList.add('hidden'); $('.pills').classList.remove('hidden'); }
let searchSeq = 0;
async function doSearch(q, typing) {
  const box = $('#searchResults'), seq = ++searchSeq, c = map.getCenter(), ctr = { lat: c.lat, lng: c.lng };
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) { closeSearch(); S.follow = false; $('#btnLocate').classList.remove('follow'); map.setView([+m[1], +m[2]], 15); return; }
  $('.pills').classList.add('hidden'); box.classList.remove('hidden');
  const nq = norm(q), res = [];
  S.spots.filter(s => norm(s.name + s.fish + s.note + (s.rules || '')).includes(nq)).forEach(s => res.push({ lat: s.lat, lng: s.lng, name: s.name, sub: '📍 จุดของฉัน', pri: 0, spotId: s.id }));
  S.catches.filter(k => norm(k.species + (k.bait || '') + (k.note || '')).includes(nq)).slice(0, 12).forEach(k => { const sp = S.spots.find(s => s.id === k.spotId), lat = k.lat ?? sp?.lat, lng = k.lng ?? sp?.lng; if (lat == null) return;
    res.push({ lat, lng, name: k.species + (k.wt ? ` ${k.wt} กก.` : k.len ? ` ${k.len} ซม.` : ''), sub: `🐟 ปลาที่จับได้ · ${new Date(k.t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}${k.bait ? ' · ' + k.bait : ''}${sp ? ' · ' + sp.name : ''}`, pri: 0, catchId: k.id }); });
  (waterC || S.water || []).filter(w => w.name && norm(w.name).includes(nq)).slice(0, 40).forEach(w => res.push({ lat: w.lat, lng: w.lng, name: w.name, sub: '💧 ' + w.kind, pri: 1 }));
  loadTambons().then(T => { if (!T || seq !== searchSeq) return; T.filter(t => norm(t[2]).includes(nq) || norm(t[3]) === nq).slice(0, 15).forEach(t => res.push({ lat: t[0], lng: t[1], name: 'ต.' + t[2], sub: 'ตำบล · อ.' + t[3], pri: 3 })); render(left > 0); });
  const render = loading => {
    if (seq !== searchSeq) return;
    const seen = [], list = [];
    res.map(r => ({ ...r, d: dist(ctr, r) })).sort((x, y) => (x.pri - y.pri) || (x.d - y.d)).forEach(r => {
      if (!r.catchId && seen.some(o => !o.catchId && norm(o.name) === norm(r.name) && dist(o, r) < 400)) return; seen.push(r); list.push(r);
    });
    box.innerHTML = (list.length ? list.slice(0, 25).map((r, i) => `<button data-i="${i}"><b>${esc(r.name)}</b><small>${fmtDist(r.d)}</small><span>${esc(r.sub)}</span></button>`).join('') : loading ? '' : `<div class="empty">ไม่พบ "${esc(q)}"<br><span class="sub">ลองพิมพ์ชื่อเฉพาะ เช่น "อ่างแม่กวง" "หนองบัว สันทราย" หรือกดปุ่ม 💧 เพื่อหาแหล่งน้ำรอบแผนที่</span></div>`)
      + (loading ? '<div class="empty">กำลังค้นหา…</div>' : '');
    $$('button', box).forEach(b => b.onclick = () => {
      const r = list[b.dataset.i]; closeSearch(); $('#searchInput').blur();
      S.follow = false; $('#btnLocate').classList.remove('follow'); map.setView([r.lat, r.lng], 15);
      if (r.catchId) catchSheet(r.catchId);
      else if (r.spotId) spotSheet(r.spotId);
      else { searchPin.setLatLng([r.lat, r.lng]).addTo(map).bindPopup(`<b>${esc(r.name)}</b><br>กดค้างบนแผนที่เพื่อปักหมุด<br><a href="${svUrl(r)}" target="_blank" rel="noopener">ดูภาพถนน (Street View)</a>`).openPopup(); }
    });
  };
  let left = typing ? 1 : 3; render(true);
  if (navigator.onLine === false) { left = 0; render(false); return; }
  const d = .9, vb = `${(c.lng - d).toFixed(3)},${(c.lat + d).toFixed(3)},${(c.lng + d).toFixed(3)},${(c.lat - d).toFixed(3)}`;
  const nomi = extra => fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=12&accept-language=th&countrycodes=th&addressdetails=1&q=${encodeURIComponent(q)}${extra}`).then(r => r.json()).then(js => js.forEach(p => {
    const ad = p.address || {}, area = [ad.village || ad.hamlet || ad.suburb, ad.town || ad.city || ad.municipality || ad.county, ad.state].filter(Boolean).join(' · ');
    res.push({ lat: +p.lat, lng: +p.lon, name: p.name || p.display_name.split(',')[0], sub: [KIND_TH[p.type] || KIND_TH[p.category], area].filter(Boolean).join(' · '), pri: 2 });
  })).catch(() => {});
  const photon = fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&limit=12&bbox=97.3,5.5,105.7,20.5`).then(r => r.json()).then(js => (js.features || []).forEach(f => {
    const p = f.properties || {}, g = f.geometry?.coordinates; if (!g || !p.name || (p.countrycode && p.countrycode !== 'TH')) return;
    res.push({ lat: g[1], lng: g[0], name: p.name, sub: [KIND_TH[p.osm_value] || KIND_TH[p.osm_key], p.district || p.city || p.county, p.state].filter(Boolean).join(' · '), pri: 2 });
  })).catch(() => {});
  const done = () => render(--left > 0);
  photon.then(done);                                   // สะกดไม่เป๊ะก็เจอ ใช้ตอนพิมพ์ได้
  if (typing) return;                                  // Nominatim ห้ามยิงทุกตัวอักษร: ใช้เฉพาะตอนกดค้นหา
  nomi(`&viewbox=${vb}&bounded=1`).then(done);        // ใกล้แผนที่ก่อน (~100 กม.)
  nomi(`&viewbox=${vb}`).then(done);                   // ทั่วประเทศ                                   // สะกดไม่เป๊ะก็เจอ
}
$('#searchForm').onsubmit = e => { e.preventDefault(); clearTimeout(searchDeb); const q = $('#searchInput').value.trim(); if (q) doSearch(q); };
let searchDeb; $('#searchInput').oninput = e => {
  clearTimeout(searchDeb); const q = e.target.value.trim();
  if (!q) { searchSeq++; closeSearch(); return; }
  if (q.length >= 3) searchDeb = setTimeout(() => doSearch(q, true), 700);
};

/* ============ ชื่อสถานที่จากพิกัด (reverse geocode) ============ */
const placeCache = ls.get('places4', {});
let tambonP = null;
const loadTambons = () => tambonP || (tambonP = fetch('tambon.json').then(r => r.json()).catch(() => { tambonP = null; return null; }));
const cutAdm = s => s && s.replace(/^(ตำบล|อำเภอ|จังหวัด|เขต|แขวง)\s*/, '');
// ตำบล: ใช้จุดกึ่งกลางตำบลที่ใกล้ที่สุด (ภายในอำเภอเดียวกันถ้ารู้อำเภอ) เพราะข้อมูลตำบลใน OSM เชื่อไม่ได้ — ใกล้เส้นแบ่งตำบลอาจคลาดได้
async function nearestTambon(lat, lng, amphoe) {
  const T = await loadTambons(); if (!T) return null;
  const best = list => { let b = null, bd = 1e12; for (const t of list) { const d = dist({ lat, lng }, { lat: t[0], lng: t[1] }); if (d < bd) { bd = d; b = t; } } return b && bd < 20000 ? { tambon: b[2], amphoe: b[3] } : null; };
  const box = T.filter(t => Math.abs(t[0] - lat) < .25 && Math.abs(t[1] - lng) < .25), same = amphoe ? box.filter(t => t[3] === amphoe) : [];
  return best(same.length ? same : box);
}
async function placeName(lat, lng) {
  const k = lat.toFixed(2) + ',' + lng.toFixed(2);
  if (placeCache[k]) return placeCache[k];
  let small = '', mid = '', big = '';
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=th&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`);
    const ad = (await r.json()).address || {};
    small = ad.hamlet || ad.village || ad.neighbourhood || ''; mid = cutAdm(ad.county || ad.city_district || ad.district || '') || ''; big = cutAdm(ad.province || ad.state || '') || '';
  } catch {}
  const tb = await nearestTambon(lat, lng, mid);
  const tambon = tb?.tambon || '', amphoe = mid || tb?.amphoe || '';
  const out = { short: tambon || amphoe || small || big, full: [tambon, amphoe || big].filter(Boolean).join(' · ') || small || big, village: small };
  if (!out.short) return null;
  placeCache[k] = out; const ks = Object.keys(placeCache); if (ks.length > 60) delete placeCache[ks[0]]; ls.set('places4', placeCache);
  return out;
}

// ใกล้รอยต่อตำบล แอปอาจเลือกผิด: ให้ผู้ใช้แตะชื่อสถานที่เพื่อเลือกตำบลที่ถูกเองได้ (จำไว้สำหรับบริเวณนั้น)
async function pickTambon() {
  const loc = S.fcLoc, T = await loadTambons(); if (!loc || !T) return toast('ยังโหลดรายชื่อตำบลไม่ได้');
  const near = T.map(t => ({ t, d: dist(loc, { lat: t[0], lng: t[1] }) })).sort((x, y) => x.d - y.d).slice(0, 6);
  openSheet(`<h3>อยู่ตำบลไหน?</h3><div class="sub">แอปเดาจากจุดกึ่งกลางตำบลที่ใกล้ที่สุด ถ้าไม่ตรง เลือกที่ถูกได้เลย แอปจะจำไว้สำหรับบริเวณนี้</div>` +
    near.map((x, i) => `<button class="menu-item" data-tb="${i}"><span class="mi">📍</span><span><b>${esc(x.t[2])}${loc.place?.short === x.t[2] ? ' ✓' : ''}</b><span class="sub">อ.${esc(x.t[3])} · ศูนย์กลางห่าง ${fmtDist(x.d)}</span></span></button>`).join(''));
  $$('#sheet [data-tb]').forEach(b => b.onclick = () => {
    const t = near[b.dataset.tb].t, p = { short: t[2], full: `${t[2]} · ${t[3]}`, manual: true };
    placeCache[loc.lat.toFixed(2) + ',' + loc.lng.toFixed(2)] = p; ls.set('places4', placeCache); loc.place = p; showPlace(); closeSheet();
  });
}
$('#fcPlace').onclick = pickTambon;

/* ============ forecast & fish score ============ */
const wmo = (c, night) => { const w = WMO[c] || WMO[[0, 1, 2, 3, 45, 51, 61, 80, 95].reduce((a, b) => Math.abs(b - c) < Math.abs(a - c) ? b : a)]; return { txt: w[0], ico: night ? w[2] : w[1] }; };
const scoreColor = s => s >= 76 ? '#22c55e' : s >= 68 ? '#84cc16' : s >= 60 ? '#facc15' : s >= 50 ? '#f59e0b' : s >= 40 ? '#f97316' : '#ef4444';   // แดง=ไม่กิน → เหลือง → เขียว=กินดี
const scoreLabel = s => s >= 85 ? 'ปลากินกระจาย' : s >= 76 ? 'ปลากินดี' : s >= 62 ? 'ปลาเริ่มกิน' : s >= 50 ? 'พอมีลุ้น' : s >= 40 ? 'ปลากินน้อย' : 'ปลาไม่ค่อยกิน';
function moonName(p) {
  const age = p * 29.53, ico = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'][Math.round(p * 8) % 8];
  const txt = p < 0.5 ? `ขึ้น ${clamp(Math.round(age), 1, 15)} ค่ำ` : `แรม ${clamp(Math.round(age - 14.77), 1, 15)} ค่ำ`;
  return `${ico} ${txt} (โดยประมาณ)`;
}
function moonEvents(t0, t1, lat, lng) {
  const ev = []; let p2 = null, p1 = null;
  for (let t = t0 - 9e5; t <= t1 + 9e5; t += 9e5) {
    const a = SunCalc.getMoonPosition(new Date(t), lat, lng).altitude;
    if (p1 && p2) {
      if (p1.a > p2.a && p1.a > a) ev.push({ t: p1.t, type: 'major', label: 'จันทร์ตรงหัว' });
      if (p1.a < p2.a && p1.a < a) ev.push({ t: p1.t, type: 'major', label: 'จันทร์ใต้เท้า' });
      if ((p1.a < 0) !== (a < 0)) ev.push({ t, type: 'minor', label: a > 0 ? 'จันทร์ขึ้น' : 'จันทร์ตก' });
    }
    p2 = p1; p1 = { t, a };
  }
  return ev;
}
function buildWx(d, lat, lng) {
  const h = d.hourly, T = h.time.map(t => new Date(t)), n = T.length;
  const ev = moonEvents(T[0].getTime(), T[n - 1].getTime(), lat, lng);
  const sunCache = {};
  const sun = t => { const k = t.toDateString(); return sunCache[k] || (sunCache[k] = SunCalc.getTimes(new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12), lat, lng)); };
  const H = [];
  for (let i = 0; i < n; i++) {
    const t = T[i], ms = t.getTime(), st = sun(t);
    const p = h.pressure_msl[i], dp = p - h.pressure_msl[Math.max(0, i - 3)];
    const w = h.wind_speed_10m[i], r = h.precipitation[i] || 0, code = h.weather_code[i], cl = h.cloud_cover[i], tmp = h.temperature_2m[i];
    let s = 48;
    if (dp <= -0.4 && dp >= -2.5) s += 12; else if (Math.abs(dp) < 0.4) s += 6; else if (dp < -2.5) s -= 4; else if (dp > 2) s -= 8; else s += 1;
    if (w >= 3 && w <= 15) s += 8; else if (w < 3) s += 3; else if (w > 25) s -= 12;
    if (code >= 95) s -= 18; else if (r > 5) s -= 10; else if (r > 0.1) s += 4;
    const mid = ms + 18e5, dSun = Math.min(Math.abs(mid - st.sunrise), Math.abs(mid - st.sunset)) / 36e5;
    if (dSun <= 1.2) s += 15; else if (dSun <= 2.2) s += 8;
    const day = mid > st.sunrise && mid < st.sunset;
    if (day) { if (Math.abs(mid - st.solarNoon) / 36e5 < 2) s += cl > 60 ? 2 : -6; } else s += 2;
    if (ev.some(e => e.type === 'major' && Math.abs(e.t - mid) <= 75 * 6e4)) s += 12;
    else if (ev.some(e => e.type === 'minor' && Math.abs(e.t - mid) <= 45 * 6e4)) s += 6;
    const ill = SunCalc.getMoonIllumination(t).fraction; if (ill < .08 || ill > .92) s += 5;
    if (tmp < 14 || tmp > 37) s -= 6; else if (tmp >= 20 && tmp <= 33) s += 3;
    s += personalAdj(t.getHours());
    H.push({ t, temp: tmp, pres: p, sp: h.surface_pressure[i], dp, wind: w, gust: h.wind_gusts_10m?.[i] ?? w, wdir: h.wind_direction_10m[i], rain: r, pop: h.precipitation_probability?.[i], code, cloud: cl, hum: h.relative_humidity_2m[i], day, score: clamp(Math.round(s), 5, 98) });
  }
  const nowMs = Date.now(); let ni = H.findIndex(x => x.t.getTime() + 36e5 > nowMs); if (ni < 0) ni = 0;
  const days = d.daily.time.map((ds, i) => {
    const all = H.filter(x => x.t.toDateString() === new Date(ds + 'T12:00').toDateString() && x.t.getHours() >= 4 && x.t.getHours() <= 22).map(x => x.score).sort((a, b) => b - a);
    const avg = v => v.reduce((a, b) => a + b, 0) / v.length;   // เฉลี่ยทั้งวัน ถ่วงน้ำหนักช่วงพีค
    return { date: new Date(ds + 'T12:00'), code: d.daily.weather_code[i], max: d.daily.temperature_2m_max[i], min: d.daily.temperature_2m_min[i], pop: d.daily.precipitation_probability_max?.[i], score: all.length ? Math.round(avg(all.slice(0, 4)) * .45 + avg(all) * .55) : 0 };
  }).filter(x => x.date.getTime() >= new Date().setHours(0, 0, 0, 0));
  const next = H.slice(ni, ni + 24); let bi = 0;
  for (let i = 0; i < next.length - 1; i++) if (next[i].score + next[i + 1].score > next[bi].score + next[bi + 1].score) bi = i;
  return { H, ni, next, bi, days, ev: ev.filter(e => e.t > nowMs - 36e5 && e.t < nowMs + 26 * 36e5), now: H[ni], lat, lng, fetched: d._fetched || Date.now() };
}
let wxC = null;   // พยากรณ์ที่เก็บไว้ใช้ออฟไลน์ (หลายจุด)
async function wxCacheAll() { if (!wxC) { try { wxC = (await DB.get('wxc')) || []; } catch { wxC = []; } } return wxC; }
async function wxCachePut(loc, d) {
  const all = await wxCacheAll(), i = all.findIndex(x => dist(x, loc) < 3000);
  const rec = { lat: loc.lat, lng: loc.lng, t: Date.now(), d }; if (i >= 0) all.splice(i, 1); all.unshift(rec); all.length = Math.min(all.length, 20);
  DB.set('wxc', all).catch(() => {});
}
async function wxCacheGet(loc) {
  const all = await wxCacheAll(), ok = all.filter(x => Date.now() - x.t < 13 * 864e5).map(x => ({ x, d: dist(x, loc) })).filter(o => o.d < 30000).sort((p, q) => p.d - q.d)[0];
  return ok ? ok.x.d : null;
}
async function wxPrefetch(loc) { try { if ((await wxCacheAll()).some(x => dist(x, loc) < 3000 && Date.now() - x.t < 3 * 36e5)) return true; const r = await fetch(wxUrl(loc)); if (!r.ok) return false; const d = await r.json(); d._fetched = Date.now(); await wxCachePut(loc, d); return true; } catch { return false; } }
const wxUrl = loc => `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat.toFixed(4)}&longitude=${loc.lng.toFixed(4)}&hourly=wind_gusts_10m,temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,pressure_msl,surface_pressure,cloud_cover,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=14&past_days=1`;
async function loadForecast(loc) {
  if (loc) S.fcLoc = loc; loc = S.fcLoc; if (!loc) return;
  $('#fcPlace').textContent = loc.name;
  const url = wxUrl(loc);
  let d = null, stale = false;
  try { const r = await fetch(url); if (!r.ok) throw 0; d = await r.json(); d._fetched = Date.now(); wxCachePut(loc, d); }
  catch { d = await wxCacheGet(loc); stale = !!d; }
  if (!d) { $('#fcBody').innerHTML = '<div class="empty">โหลดพยากรณ์ไม่ได้ ยังไม่มีพยากรณ์ของบริเวณนี้เก็บไว้ (ต้องต่อเน็ตสักครั้ง หรือกด “เตรียมออฟไลน์” ไว้ก่อนออกทริป)<br><br><button class="btn" onclick="loadForecast()">ลองใหม่</button></div>'; return; }
  if (!loc.place) placeName(loc.lat, loc.lng).then(p => { if (p && p.short && S.fcLoc === loc) { loc.place = p; showPlace(); } });
  try { S.wx = buildWx(d, loc.lat, loc.lng); S.wx.stale = stale; } catch (e) { console.error(e); $('#fcBody').innerHTML = '<div class="empty">ข้อมูลพยากรณ์ผิดรูปแบบ</div>'; return; }
  renderForecast(); renderTools();
}
window.loadForecast = loadForecast;
function showPlace() {
  const loc = S.fcLoc; if (!loc) return;
  const generic = loc.auto || /^กลางแผนที่/.test(loc.name);
  $('#fcPlace').textContent = loc.place ? (generic ? '📍 ' + loc.place.full : `${loc.name} · ${loc.place.full}`) : loc.name;
  $('#wxPillPlace').textContent = loc.place ? loc.place.short : '';
  const el = $('#fcNowPlace'); if (el) el.textContent = loc.place ? 'ตอนนี้ที่ ' + (generic ? loc.place.short : loc.name) : 'ตอนนี้';
}
function rainOutlook(next) {
  const wet = x => (x.pop ?? 0) >= 50 || x.rain >= 0.3, h12 = next.slice(0, 12), i = h12.findIndex(wet);
  const mx = Math.max(...h12.map(x => x.pop ?? 0));
  if (i < 0) return { ok: true, txt: `12 ชม.ข้างหน้าไม่น่ามีฝน (โอกาสสูงสุด ${mx}%)` };
  let j = i; while (j + 1 < h12.length && wet(h12[j + 1])) j++;
  const mm = h12.slice(i, j + 1).reduce((s, x) => s + x.rain, 0);
  return { ok: false, txt: `${i === 0 ? 'ฝนกำลังตก/ใกล้ตก' : 'ฝนน่าจะเริ่ม ~' + pad(h12[i].t.getHours()) + ':00'} ถึง ~${pad((h12[j].t.getHours() + 1) % 24)}:00 · โอกาส ${Math.max(...h12.slice(i, j + 1).map(x => x.pop ?? 0))}% · รวม ~${mm.toFixed(1)} มม.` };
}
function season(d = new Date()) { const m = d.getMonth() + 1; return SEASONS.find(s => s.m.includes(m)) || SEASONS[0]; }
function renderAlert() {
  const el = $('#alertBar'), W = S.wx; if (!W) return;
  const h3 = W.next.slice(0, 4), at = x => pad(x.t.getHours()) + ':00', msgs = [];
  const th = h3.find(x => x.code >= 95), hv = h3.find(x => x.rain >= 5), gs = h3.find(x => x.gust >= 45 || x.wind >= 30), ht = h3.find(x => x.temp >= 38);
  if (th) msgs.push(`⛈️ พายุฝนฟ้าคะนอง ~${at(th)} เก็บคัน ออกห่างน้ำและต้นไม้สูง`);
  if (hv && !th) msgs.push(`🌧️ ฝนหนัก ~${at(hv)} (${hv.rain.toFixed(0)} มม./ชม.) ระวังน้ำป่า ทางลื่น`);
  if (gs) msgs.push(`💨 ลมแรง ~${at(gs)} กระโชก ${Math.round(Math.max(gs.gust, gs.wind))} กม./ชม.`);
  if (ht) msgs.push(`🥵 ร้อนจัด ${Math.round(ht.temp)}° ~${at(ht)} ดื่มน้ำ หลบแดด`);
  el.classList.toggle('hidden', !msgs.length); el.classList.toggle('severe', !!th);
  el.innerHTML = msgs.map(m => `<div>${m}</div>`).join('') + (msgs.length ? `<small>ใน 3 ชม. ที่ ${esc(S.fcLoc?.place?.short || S.fcLoc?.name || '')}</small>` : '');
  return msgs;
}
function renderForecast() {
  const W = S.wx, n = W.now, wm = wmo(n.code, !n.day), sn = season(), mo = new Date().getMonth() + 1;
  const best = W.next[W.bi], best2 = W.next[W.bi + 1] || best;
  const bestTxt = `${DAYS[best.t.getDay()]} ${pad(best.t.getHours())}:00 – ${pad((best2.t.getHours() + 1) % 24)}:00`;
  const C = 2 * Math.PI * 40, sun = SunCalc.getTimes(new Date(), W.lat, W.lng), mp = SunCalc.getMoonIllumination(new Date()).phase;
  const maxDay = Math.max(...W.days.map(x => x.score));
  const trend = n.dp < -0.4 ? '↘ กำลังลด' : n.dp > 0.4 ? '↗ กำลังเพิ่ม' : '→ คงที่';
  const fishNow = FISH.filter(f => f.m.includes(mo)).slice(0, 8);
  $('#wxPillTemp').textContent = `${wm.ico} ${Math.round(n.temp)}°C`;
  $('#wxPillScore').textContent = n.score; $('#wxPillScore').style.background = scoreColor(n.score);
  $('#seasonPillText').textContent = `${sn.icon} ${sn.name}`;
  const keepScroll = $('#view-forecast').scrollTop;
  $('#fcBody').innerHTML = `
  ${W.stale ? `<div class="warn">ออฟไลน์อยู่ – แสดงข้อมูลที่โหลดไว้ล่าสุด ${new Date(W.fetched).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</div>` : ''}
  <div class="card">
    <div class="fc-now"><div><div class="sub" id="fcNowPlace">ตอนนี้</div><div class="fc-temp">${Math.round(n.temp)}°C</div><div class="sub">${wm.txt}</div></div><div class="fc-ico">${wm.ico}</div></div>
    <div class="score-row">
      <div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" style="stroke:var(--track)" stroke-width="9"/><circle cx="50" cy="50" r="40" fill="none" stroke="${scoreColor(n.score)}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C * n.score / 100} ${C}"/></svg><b>${n.score}</b></div>
      <div><div class="score-label">${scoreLabel(n.score)}</div><div class="sub">🔥 ช่วงดีที่สุด: ${bestTxt}</div></div>
    </div>
    <div class="bars">${W.next.map((x, i) => `<div class="${i === 0 ? 'now' : ''} ${i === W.bi || i === W.bi + 1 ? 'best' : ''}" style="height:${clamp(x.score, 8, 100)}%;background:${scoreColor(x.score)}"></div>`).join('')}</div>
    <div class="scale"><i style="background:#ef4444"></i>ไม่กิน<i style="background:#f59e0b"></i>พอลุ้น<i style="background:#facc15"></i>เริ่มกิน<i style="background:#22c55e"></i>กินดี</div>
    <div class="bar-axis"><span>ตอนนี้</span>${[6, 12, 18].map(k => `<span>${pad(W.next[k]?.t.getHours() ?? 0)}</span>`).join('')}<span>+24ชม.</span></div>
  </div>
  ${(() => { const m = renderAlert() || []; return m.length ? `<div class="warn alert-in">${m.map(x => `<div>${x}</div>`).join('')}</div>` : ''; })()}
  ${(() => { const r = rainOutlook(W.next); return `<div class="card rain-card ${r.ok ? 'dry' : 'wet'}"><div class="card-h">${r.ok ? '🌂' : '🌧️'} ฝนที่จุดนี้</div><div>${r.txt}</div><div class="row"><button class="btn ghost small" id="fcRainMap">🗺️ ดูฝนบนแผนที่</button></div></div>`; })()}
  <div class="card"><div class="card-h">🌙 ช่วงปลากินตามดวงจันทร์ (24 ชม.)</div>
    <div class="solunar">${W.ev.length ? W.ev.map(e => `<span class="chip ${e.type}">${e.type === 'major' ? '★ ' : ''}${hm(new Date(e.t))} ${e.label}</span>`).join('') : '<span class="sub">-</span>'}</div>
    <div class="sub" style="margin-top:8px">★ = ช่วงหลัก (ราว ±1 ชม.) · ${moonName(mp)}</div></div>
  <div class="card"><div class="card-h">รายชั่วโมง</div><div class="hours">${W.next.map(x => { const m = wmo(x.code, !x.day); return `<div class="h"><div class="t">${pad(x.t.getHours())}</div><div class="e">${m.ico}</div><div>${Math.round(x.temp)}°</div><div class="sub">${Math.round(x.wind)} กม.</div><div class="sub">${x.pop ?? 0}%💧</div><div class="s" style="background:${scoreColor(x.score)}">${x.score}</div></div>`; }).join('')}</div></div>
  <div class="card"><div class="card-h">พยากรณ์ ${W.days.length} วัน</div><div class="days">${W.days.map((x, i) => `<div class="d ${i === 0 ? 'today' : ''}"><span class="dn">${i === 0 ? 'วันนี้' : DAYS[x.date.getDay()] + ' ' + x.date.getDate()}</span><span>${wmo(x.code).ico}</span><span class="track"><i style="width:${x.score}%;background:${scoreColor(x.score)}"></i></span><span class="sc ${x.score === maxDay ? 'top' : ''}" style="${x.score === maxDay ? '' : 'color:' + scoreColor(x.score)}">${x.score}</span><span class="tt">${Math.round(x.max)}° <span>${Math.round(x.min)}°</span></span></div>`).join('')}</div></div>
  <div class="card-h" style="margin:16px 2px 8px">สภาพแวดล้อม</div>
  <div class="env">
    <div><div class="sub">💨 ลม</div><div class="v">${Math.round(n.wind)} <small>กม./ชม.</small></div><div class="sub">จากทิศ${dirTxt(n.wdir)}</div></div>
    <div><div class="sub">⏱ ความกดอากาศ</div><div class="v">${Math.round(n.pres)} <small>hPa</small></div><div class="sub">${trend} · ที่พื้น ${Math.round(n.sp)}</div></div>
    <div><div class="sub">💧 ความชื้น / ฝน</div><div class="v">${Math.round(n.hum)}<small>%</small></div><div class="sub">โอกาสฝน ${n.pop ?? 0}%</div></div>
    <div><div class="sub">🌅 พระอาทิตย์</div><div class="v">${hm(sun.sunrise)}</div><div class="sub">ตก ${hm(sun.sunset)}</div></div>
  </div>
  <div class="card" style="margin-top:12px" id="damCard"><div class="card-h">🌊 ระดับน้ำเขื่อน/อ่างใกล้ที่นี่</div><div class="sub">กำลังโหลด…</div></div>
  <div class="card"><div class="card-h">${sn.icon} ${sn.name}</div><div class="sub" style="color:var(--tx)">${sn.tip}</div>
    ${sn.law ? `<div class="warn" style="margin:10px 0 0">${sn.law}</div>` : ''}
    <div class="card-h" style="margin-top:12px;font-size:15px">น่าตกช่วงนี้</div>
    <div class="fishrow">${fishNow.map(f => `<div class="fish"><b>${f.n}</b><p>🪱 ${f.bait}</p><p>📍 ${f.where}</p></div>`).join('')}</div></div>
  <div class="row"><button class="btn ghost small" id="fcMine">📍 ดูที่ตำแหน่งของฉัน</button><button class="btn ghost small" id="fcCenter">🎯 ดูที่กลางแผนที่</button></div>
  <div class="foot sub">คะแนน 0–100 คำนวณในเครื่องจาก แนวโน้มความกดอากาศ ลม ฝน ช่วงแสงเช้า-เย็น และตำแหน่งดวงจันทร์${S.catches.length >= MIN_PERSONAL ? ' · ปรับตามสถิติการจับปลาของคุณแล้ว' : ''}</div>`;
  showPlace(); renderAlert(); renderDamCard(); $('#view-forecast').scrollTop = keepScroll;
  $('#fcRainMap').onclick = () => { showTab('map'); map.setView([W.lat, W.lng], Math.min(map.getZoom(), 11)); setRain(true); };
  $('#fcMine').onclick = () => S.pos ? loadForecast({ lat: S.pos.lat, lng: S.pos.lng, name: 'ตำแหน่งของฉัน', auto: true }) : toast('ยังไม่ได้ตำแหน่ง GPS');
  $('#fcCenter').onclick = () => { const c = map.getCenter(); loadForecast({ lat: c.lat, lng: c.lng, name: `กลางแผนที่ (${c.lat.toFixed(3)}, ${c.lng.toFixed(3)})` }); };
}
$('#fcRefresh').onclick = () => { toast('กำลังรีเฟรช…'); loadForecast(); };
$('#alertBar').onclick = () => showTab('forecast');
$('#wxPill').onclick = () => showTab('forecast');
$('#seasonPill').onclick = () => { showTab('forecast'); setTimeout(() => $('#view-forecast').scrollTo({ top: 99999, behavior: 'smooth' }), 80); };

/* ============ ฝนบนแผนที่: เรดาร์ล่าสุด + พยากรณ์รายชั่วโมงเป็นตาราง ============ */
const gRain = L.layerGroup().addTo(map);
const R = { on: false, grid: null, hour: 0, radar: null, radarTime: null, key: '' };
const rainStyle = (mm, pop) => mm >= 10 ? ['#dc2626', .5] : mm >= 4 ? ['#f59e0b', .5] : mm >= 1 ? ['#2563eb', .5] : mm >= 0.1 ? ['#3b82f6', .35] : pop >= 40 ? ['#60a5fa', .18] : null;
async function loadRadar() {
  try {
    const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json(), f = j.radar.past[j.radar.past.length - 1];
    if (R.radar) map.removeLayer(R.radar);
    R.radar = L.tileLayer(`${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: .65, maxNativeZoom: 7, maxZoom: 19, zIndex: 300, attribution: 'RainViewer' });
    R.radarTime = new Date(f.time * 1000);
  } catch { R.radar = null; R.radarTime = null; }
}
async function loadRainGrid() {
  const b = map.getBounds().pad(.05), nx = 5, ny = 6, la = [], lo = [], cells = [];
  const dLat = (b.getNorth() - b.getSouth()) / ny, dLng = (b.getEast() - b.getWest()) / nx;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const s = b.getSouth() + y * dLat, w = b.getWest() + x * dLng;
    cells.push([[s, w], [s + dLat, w + dLng]]); la.push((s + dLat / 2).toFixed(3)); lo.push((w + dLng / 2).toFixed(3));
  }
  const key = la[0] + lo[0] + la[la.length - 1] + lo[lo.length - 1]; if (key === R.key && R.grid) return; R.key = key;
  $('#rainLabel').textContent = 'กำลังโหลดพยากรณ์ฝน…';
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la.join(',')}&longitude=${lo.join(',')}&hourly=precipitation,precipitation_probability&forecast_hours=13&timezone=auto`);
    if (!r.ok) throw 0; const js = await r.json(); if (key !== R.key) return;
    R.grid = (Array.isArray(js) ? js : [js]).map((d, i) => ({ box: cells[i], t: d.hourly.time, mm: d.hourly.precipitation, pop: d.hourly.precipitation_probability }));
  } catch { R.grid = null; R.key = ''; $('#rainLabel').textContent = 'โหลดพยากรณ์ฝนไม่ได้ (ต้องต่อเน็ต)'; return; }
  drawRain();
}
function drawRain() {
  gRain.clearLayers(); if (!R.on) return;
  const h = R.hour;
  if (R.radar) { if (h === 0) R.radar.addTo(map); else map.removeLayer(R.radar); }
  if (!R.grid) return;
  let wet = 0;
  R.grid.forEach(c => {
    const mm = c.mm[h] ?? 0, pop = c.pop?.[h] ?? 0, st = rainStyle(mm, pop); if (!st) return; wet++;
    L.rectangle(c.box, { stroke: false, fillColor: st[0], fillOpacity: st[1], interactive: false }).addTo(gRain);
    const ctr = [(c.box[0][0] + c.box[1][0]) / 2, (c.box[0][1] + c.box[1][1]) / 2];
    L.marker(ctr, { interactive: false, icon: L.divIcon({ className: '', html: `<div class="rainlbl">${pop}%${mm >= 0.1 ? `<small>${mm.toFixed(1)}มม.</small>` : ''}</div>`, iconSize: [50, 30], iconAnchor: [25, 15] }) }).addTo(gRain);
  });
  const t = new Date(R.grid[0].t[h]);
  $('#rainLabel').innerHTML = `<b>${h === 0 ? 'ตอนนี้' : '+' + h + ' ชม.'} · ${pad(t.getHours())}:00</b> ${wet ? `มีโอกาสฝน ${wet}/${R.grid.length} ช่อง` : 'ไม่มีฝนในบริเวณที่เห็น'}${h === 0 ? (R.radarTime ? ` · เรดาร์ ${hm(R.radarTime)}` : ' · ไม่มีภาพเรดาร์') : ''}`;
}
async function setRain(on) {
  if (on && navigator.onLine === false) return toast('แผนที่ฝนต้องใช้เน็ต · ดูโอกาสฝนรายชั่วโมงที่เก็บไว้ได้ในหน้าพยากรณ์', 4500);
  R.on = on; $('#btnRain').classList.toggle('on', on); $('#rainBar').classList.toggle('hidden', !on);
  if (!on) { gRain.clearLayers(); if (R.radar) map.removeLayer(R.radar); return; }
  R.hour = 0; $('#rainSlider').value = 0; R.key = '';
  await Promise.all([loadRadar(), loadRainGrid()]); drawRain();
}
$('#btnRain').onclick = () => setRain(!R.on);
$('#rainClose').onclick = () => setRain(false);
$('#rainSlider').oninput = e => { R.hour = +e.target.value; drawRain(); };
let rainDeb; map.on('moveend', () => { if (!R.on) return; clearTimeout(rainDeb); rainDeb = setTimeout(loadRainGrid, 700); });

/* ============ survival tools ============ */
function renderTools() {
  if (S.pos) {
    $('#myCoords').textContent = `${S.pos.lat.toFixed(6)}, ${S.pos.lng.toFixed(6)}`;
    $('#myCoordsDms').textContent = `${dms(S.pos.lat, 'N', 'S')}  ${dms(S.pos.lng, 'E', 'W')}`;
    $('#myAcc').textContent = `แม่นยำ ±${Math.round(S.pos.acc)} ม.${S.pos.alt != null ? ` · สูง ${Math.round(S.pos.alt)} ม.` : ''}${S.pos.spd ? ` · ${(S.pos.spd * 3.6).toFixed(1)} กม./ชม.` : ''}`;
  }
  const c = S.pos || (() => { const m = map.getCenter(); return { lat: m.lat, lng: m.lng }; })();
  const now = new Date(), st = SunCalc.getTimes(now, c.lat, c.lng), mt = SunCalc.getMoonTimes(now, c.lat, c.lng);
  let left;
  if (now < st.sunrise) left = ['อีก ' + durTxt(st.sunrise - now), 'จะสว่าง'];
  else if (now < st.dusk) left = [durTxt(Math.max(0, st.sunset - now)), now < st.sunset ? 'เหลือแสงก่อนตะวันตก' : 'ตะวันตกแล้ว มืดสนิท ' + hm(st.dusk)];
  else left = ['มืดแล้ว', 'ใช้ไฟฉาย เดินระวัง'];
  $('#sunBox').innerHTML = `<div><span class="sub">${left[1]}</span><b style="color:var(--acc)">${left[0]}</b></div>
    <div><span class="sub">ขึ้น / ตก</span><b>${hm(st.sunrise)} / ${hm(st.sunset)}</b></div>
    <div><span class="sub">สว่างพอมองเห็น</span><b>${hm(st.dawn)} – ${hm(st.dusk)}</b></div>
    <div><span class="sub">จันทร์ขึ้น / ตก</span><b>${hm(mt.rise)} / ${hm(mt.set)}</b></div>`;
  renderCompass();
}
const durTxt = ms => { const m = Math.round(ms / 6e4); return (m >= 60 ? Math.floor(m / 60) + ' ชม. ' : '') + (m % 60) + ' นาที'; };
function coordText() { return S.pos ? `${S.pos.lat.toFixed(6)}, ${S.pos.lng.toFixed(6)}` : ''; }
async function copy(txt, ok) { try { await navigator.clipboard.writeText(txt); toast(ok); } catch { toast(txt, 6000); } }
$('#copyCoords').onclick = () => S.pos ? copy(coordText(), 'คัดลอกพิกัดแล้ว') : toast('ยังไม่ได้ตำแหน่ง GPS');
$('#shareLoc').onclick = async () => {
  if (!S.pos) return toast('ยังไม่ได้ตำแหน่ง GPS');
  const text = `🆘 ต้องการความช่วยเหลือ\nตำแหน่งของฉัน: ${coordText()} (±${Math.round(S.pos.acc)} ม.)\nhttps://maps.google.com/?q=${S.pos.lat.toFixed(6)},${S.pos.lng.toFixed(6)}\nเวลา ${new Date().toLocaleString('th-TH')}`;
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copy(text, 'คัดลอกข้อความแล้ว นำไปวางใน LINE/SMS');
};

/* torch / SOS / whistle / screen light */
let torchTrack = null, sosTimer = null, sosOn = false, actx = null, whistleTimer = null;
async function setTorch(on) {
  try {
    if (!torchTrack) { if (!on) return true; const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } }); torchTrack = st.getVideoTracks()[0]; }
    if (!torchTrack.getCapabilities?.().torch) throw 0;
    await torchTrack.applyConstraints({ advanced: [{ torch: on }] }); return true;
  } catch { return false; }
}
function releaseTorch() { if (torchTrack) { torchTrack.stop(); torchTrack = null; } }
$('#tTorch').onclick = async e => {
  const b = e.currentTarget, on = !b.classList.contains('on');
  if (on) { if (await setTorch(true)) b.classList.add('on'); else { releaseTorch(); toast('เครื่อง/เบราว์เซอร์นี้สั่งไฟฉายไม่ได้ ใช้ "ไฟจอขาว" แทน'); } }
  else { await setTorch(false); releaseTorch(); b.classList.remove('on'); }
};
function showFlash(cls, label) {
  const f = $('#flash'); f.className = 'flash ' + cls; f.textContent = label + ' · แตะเพื่อปิด';
  f.onclick = () => { f.classList.add('hidden'); stopSOS(); };
}
$('#tScreen').onclick = () => showFlash('', 'ไฟจอขาว');
$('#tRed').onclick = () => showFlash('red', 'ไฟแดง (ถนอมสายตากลางคืน)');
function stopSOS() { sosOn = false; clearTimeout(sosTimer); $('#tSOS').classList.remove('on'); setTorch(false).then(releaseTorch); $('#tTorch').classList.remove('on'); }
$('#tSOS').onclick = async () => {
  if (sosOn) { stopSOS(); $('#flash').classList.add('hidden'); return; }
  sosOn = true; $('#tSOS').classList.add('on'); await setTorch(false);
  const U = 220, seq = []; // ··· ─── ···
  [[1, 1, 1], [3, 3, 3], [1, 1, 1]].forEach((g, gi) => g.forEach((n, i) => { seq.push([true, n * U]); seq.push([false, (i === 2 ? (gi === 2 ? 7 : 3) : 1) * U]); }));
  let i = 0; showFlash('off', 'SOS');
  const step = () => {
    if (!sosOn) return; const [on, ms] = seq[i % seq.length]; i++;
    $('#flash').classList.toggle('off', !on); setTorch(on); sosTimer = setTimeout(step, ms);
  };
  step();
};
$('#tWhistle').onclick = e => {
  const b = e.currentTarget;
  if (whistleTimer) { clearInterval(whistleTimer); whistleTimer = null; b.classList.remove('on'); return; }
  actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); b.classList.add('on');
  const blast = () => [0, .9, 1.8].forEach(o => {
    const osc = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + o;
    osc.type = 'square'; osc.frequency.setValueAtTime(3100, t); osc.frequency.linearRampToValueAtTime(3400, t + .6);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.9, t + .03); g.gain.setValueAtTime(.9, t + .6); g.gain.linearRampToValueAtTime(0, t + .65);
    osc.connect(g).connect(actx.destination); osc.start(t); osc.stop(t + .7);
  });
  blast(); whistleTimer = setInterval(blast, 5000);
};
function renderChecklist() {
  const st = ls.get('check', {});
  $('#checklist').innerHTML = CHECKLIST.map((c, i) => `<label class="check ${st[i] ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${st[i] ? 'checked' : ''}><span>${c}</span></label>`).join('');
  $$('#checklist input').forEach(x => x.onchange = () => { const s = ls.get('check', {}); s[x.dataset.i] = x.checked; ls.set('check', s); renderChecklist(); });
}
$('#checkReset').onclick = () => { ls.set('check', {}); renderChecklist(); };

/* ============ สถิติส่วนตัว + ปรับคะแนนตามผลจริง ============ */
const BUCKETS = [['เช้ามืด 04–07', 4, 7], ['เช้า 07–10', 7, 10], ['สาย–เที่ยง 10–14', 10, 14], ['บ่าย 14–17', 14, 17], ['เย็น 17–19', 17, 19], ['กลางคืน 19–04', 19, 28]];
const bucketOf = h => BUCKETS.findIndex(b => (h >= b[1] && h < b[2]) || (h + 24 >= b[1] && h + 24 < b[2]));
const MIN_PERSONAL = 10;
function personalAdj(hour) {   // ±คะแนนจากสัดส่วนปลาที่คุณได้จริงในช่วงเวลานั้น เทียบกับถ้าได้สม่ำเสมอทั้งวัน
  const n = S.catches.length; if (n < MIN_PERSONAL) return 0;
  const bi = bucketOf(hour), got = S.catches.filter(c => bucketOf(new Date(c.t).getHours()) === bi).length / n, exp = (BUCKETS[bi][2] - BUCKETS[bi][1]) / 24;
  return Math.round(clamp((got / exp - 1) * 6, -5, 8));
}
function topOf(arr, k = 3) { const m = {}; arr.filter(Boolean).forEach(x => m[x] = (m[x] || 0) + 1); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, k); }
function renderStats() {
  const C = S.catches, n = C.length, el = $('#myStats');
  if (n < 3) { el.innerHTML = `<div class="sub">บันทึกปลาอย่างน้อย 3 ตัว แล้วตรงนี้จะสรุปว่าคุณได้ปลาช่วงไหน เหยื่ออะไร อากาศแบบไหน (ตอนนี้ ${n} ตัว) · ครบ ${MIN_PERSONAL} ตัว แอปจะปรับคะแนนปลากินให้เข้ากับคุณ</div>`; return; }
  const bc = BUCKETS.map((b, i) => C.filter(c => bucketOf(new Date(c.t).getHours()) === i).length), mx = Math.max(...bc);
  const wx = C.filter(c => c.wx), avg = f => wx.length ? wx.reduce((s, c) => s + f(c.wx), 0) / wx.length : null;
  const moon = [['ข้างขึ้น', c => c.moon < .5], ['ข้างแรม', c => c.moon >= .5], ['ใกล้เดือนมืด/เดือนเพ็ญ', c => c.moon < .1 || c.moon > .9 || Math.abs(c.moon - .5) < .1]].map(([l, f]) => `${l} ${C.filter(c => c.moon != null && f(c)).length}`).join(' · ');
  const lst = a => a.length ? a.map(([k, v]) => `${esc(k)} (${v})`).join(', ') : '-';
  el.innerHTML = `<div class="card-h">⏰ ได้ปลาช่วงไหน</div>
  ${BUCKETS.map((b, i) => `<div class="sbar"><span>${b[0]}</span><i><em style="width:${mx ? bc[i] / mx * 100 : 0}%;${bc[i] === mx ? 'background:var(--acc)' : ''}"></em></i><b>${bc[i]}</b></div>`).join('')}
  <div class="kv" style="margin-top:12px"><span>เหยื่อได้ผล</span><b>${lst(topOf(C.map(c => c.bait)))}</b><span>ชนิดปลา</span><b>${lst(topOf(C.map(c => c.species)))}</b>
  <span>จุดที่ได้บ่อย</span><b>${lst(topOf(C.map(c => S.spots.find(s => s.id === c.spotId)?.name)))}</b>
  ${wx.length ? `<span>อากาศตอนได้</span><b>เฉลี่ย ${avg(w => w.temp).toFixed(0)}° · ${avg(w => w.pres).toFixed(0)} hPa · ลม ${avg(w => w.wind).toFixed(0)} กม./ชม. · คะแนนเฉลี่ย ${avg(w => w.score).toFixed(0)} <span class="sub">(จาก ${wx.length} ตัว)</span></b>` : ''}
  <span>ดวงจันทร์</span><b>${moon}</b></div>
  <div class="sub">${n >= MIN_PERSONAL ? '✅ คะแนนปลากินถูกปรับตามช่วงเวลาที่คุณได้ปลาจริงแล้ว (สูงสุด +8 / −5)' : `อีก ${MIN_PERSONAL - n} ตัว แอปจะเริ่มปรับคะแนนปลากินตามสถิติของคุณ`}</div>`;
}

/* ============ log ============ */
function renderLog() {
  if (OPT.catches || OPT.heat) renderSpots();
  const sp = new Set(S.catches.map(c => c.species)), big = S.catches.reduce((m, c) => Math.max(m, c.wt || 0), 0);
  $('#stats').innerHTML = `<div><b>${S.catches.length}</b><span>ปลาที่จับได้</span></div><div><b>${sp.size}</b><span>ชนิดปลา</span></div><div><b>${S.spots.length}</b><span>หมุด</span></div><div><b>${big || '-'}</b><span>กก. ใหญ่สุด</span></div>`;
  $('#catchList').innerHTML = S.catches.length ? S.catches.map(c => {
    const d = new Date(c.t), s = S.spots.find(x => x.id === c.spotId);
    return `<div class="item" data-act="catch" data-id="${c.id}"><div class="th" ${c.photo ? `style="background-image:url(${c.photo})"` : ''}>${c.photo ? '' : '🐟'}</div><div class="mid"><b>${esc(c.species)}</b><div class="sub">${[c.len && c.len + ' ซม.', c.wt && c.wt + ' กก.', c.bait && esc(c.bait)].filter(Boolean).join(' · ') || '-'}</div><div class="sub">${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${hm(d)}${s ? ' · ' + esc(s.name) : ''}</div></div></div>`;
  }).join('') : '<div class="empty">ยังไม่มีปลาในสมุด กด ＋ เพื่อบันทึกตัวแรก</div>';
  $('#spotList').innerHTML = S.spots.length ? S.spots.map(s => {
    const t = SPOT_TYPES[s.type] || SPOT_TYPES.other;
    return `<div class="item" data-act="spot" data-id="${s.id}"><div class="th" ${s.photo ? `style="background-image:url(${s.photo})"` : `style="background:${t.color}33"`}>${s.photo ? '' : t.icon}</div><div class="mid"><b>${esc(s.name)}</b><div class="sub">${t.label}${S.pos ? ' · ' + fmtDist(dist(S.pos, s)) : ''}</div>${s.note ? `<div class="sub">${esc(s.note)}</div>` : ''}</div></div>`;
  }).join('') : '<div class="empty">ยังไม่มีหมุด กดค้างบนแผนที่เพื่อปักหมุด</div>';
  renderTrackUI(); renderStats();
}
$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'pranpla', v: 1, exported: new Date().toISOString(), spots: S.spots, catches: S.catches, tracks: S.tracks })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pranpla-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('ส่งออกไฟล์สำรองแล้ว');
};
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (d.app !== 'pranpla') throw 0;
    const merge = (cur, inc) => { const ids = new Set(cur.map(x => x.id)); return cur.concat((inc || []).filter(x => x && x.id && !ids.has(x.id))); };
    S.spots = merge(S.spots, d.spots); S.catches = merge(S.catches, d.catches).sort((a, b) => b.t - a.t); S.tracks = merge(S.tracks, d.tracks); await save('tracks');
    await save('spots'); await save('catches'); renderSpots(); renderLog(); toast('นำเข้าข้อมูลแล้ว');
  } catch { toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองของพรานปลา'); }
  e.target.value = '';
};

/* ============ ธีม มืด / สว่าง / ตามเครื่อง ============ */
const mqLight = window.matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const pref = ls.get('theme', 'dark'), t = pref === 'auto' ? (mqLight.matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = t;
  $('meta[name=theme-color]').content = t === 'light' ? '#f3f6fb' : '#0a1220';
  $('meta[name=color-scheme]').content = t;
  $$('#themeSeg button').forEach(b => b.classList.toggle('sel', b.dataset.theme === pref));
}
$$('#themeSeg button').forEach(b => b.onclick = () => {
  const old = document.documentElement.dataset.theme; ls.set('theme', b.dataset.theme); applyTheme();
  const now = document.documentElement.dataset.theme;      // สลับแผนที่ตามธีมให้ด้วย ถ้ายังใช้คู่ แผนที่สว่าง/กลางคืน อยู่
  if (now !== old && (S.layer === 'light' || S.layer === 'map')) setLayer(now === 'light' ? 'light' : 'map');
  if (S.layer === 'vec') vecRestyle();
});
mqLight.addEventListener?.('change', applyTheme);
applyTheme();

/* ============ สถานะออนไลน์/ออฟไลน์ ============ */
function netState() {
  const off = navigator.onLine === false; $('#offPill').classList.toggle('hidden', !off);
  if (!off && S.fcLoc && S.wx?.stale) loadForecast();
}
window.addEventListener('online', () => { netState(); toast('กลับมาออนไลน์แล้ว'); });
window.addEventListener('offline', () => { netState(); toast('ออฟไลน์ — ใช้ข้อมูลที่เก็บไว้ในเครื่อง', 3500); });
$('#offPill').onclick = () => toast('ออฟไลน์อยู่: แผนที่ที่เก็บไว้ หมุด บันทึก เข็มทิศ พิกัด ไฟฉาย และพยากรณ์ที่โหลดไว้ ยังใช้ได้ · เรดาร์ฝนและการค้นหาสถานที่ใหม่ต้องใช้เน็ต', 7000);

/* ============ tabs ============ */
function showTab(t) {
  $$('.view').forEach(v => v.classList.toggle('show', v.id === 'view-' + t));
  $$('.tabbar [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  if (t === 'map') setTimeout(() => map.invalidateSize(), 50);
  if (t === 'tools') renderTools();
  if (t === 'log') renderLog();
  if (t === 'forecast' && S.wx && Date.now() - S.wx.fetched > 30 * 6e4) loadForecast();
}
$$('.tabbar [data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));

/* ============ boot ============ */
(async function boot() {
  try {
    S.spots = (await DB.get('spots')) || []; S.catches = (await DB.get('catches')) || [];
    S.tracks = (await DB.get('tracks')) || [];
    const tr = await DB.get('track'); if (tr) { const wasOn = tr.on; S.track = tr; S.track.on = false; trackLine.setLatLngs((tr.pts || []).map(p => [p[0], p[1]])); if ((wasOn || !tr.id) && tr.pts?.length > 1) { archiveTrack(); save('track'); } }
  } catch { toast('เปิดที่เก็บข้อมูลในเครื่องไม่ได้ ข้อมูลจะไม่ถูกบันทึก'); }
  renderSpots(); renderLog(); renderChecklist(); renderTools(); $('#crosshair').classList.toggle('hidden', !OPT.cross);
  const sn = season(); $('#seasonPillText').textContent = `${sn.icon} ${sn.name}`;
  importPinFromHash(); netState(); waterAll();
  startGeo();
  setTimeout(() => { if (!S.fcLoc) { const c = map.getCenter(); loadForecast({ lat: c.lat, lng: c.lng, name: 'กลางแผนที่ (ยังไม่มี GPS)', auto: true }); } }, 3500);
  setInterval(() => { if ($('#view-tools').classList.contains('show')) renderTools(); }, 30000);
  setInterval(() => { if (document.visibilityState !== 'visible' || !S.fcLoc) return; if (S.fcLoc.auto && S.pos) loadForecast({ lat: S.pos.lat, lng: S.pos.lng, name: 'ตำแหน่งของฉัน', auto: true }); else loadForecast(); }, 20 * 6e4);
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
