'use strict';
/* ============ ชุมชน: ผู้ใช้ที่เข้าสู่ระบบ (Google) เห็นหมุดและปลาที่จับได้ของกันและกัน (Firebase: Firestore + Auth) ============
   โครงข้อมูล: groups/all/members/{uid} · pins/{id} · catches/{id} · admins/{uid} (สร้างเองใน Console) · banned/{uid}
   ทุกเอกสารมี uid ของเจ้าของ กฎฐานข้อมูล (firestore.rules): แก้/ลบได้เฉพาะของตัวเอง แอดมินจัดการได้ทั้งหมด */
const GRP = (() => {
  const st = { gid: 'all', gname: 'ชุมชนพรานปลา', me: ls.get('myname', ''), uid: null, user: null, admin: false, banned: false, bannedList: [], db: null, ready: false, authed: false, err: '', pins: [], catches: [], members: [], unsub: [], first: { pins: false, catches: false } };
  const layer = L.layerGroup().addTo(map);
  const pushed = ls.get('grpPushed', {});           // id → ลายนิ้วมือของข้อมูลที่ส่งขึ้นไปล่าสุด กันส่งซ้ำ
  const enabled = () => !!(window.FB_CONFIG && FB_CONFIG.apiKey);
  const col = n => st.db.collection('groups').doc(st.gid).collection(n);
  const fp = o => { const s = JSON.stringify(o); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + h; };
  const initial = n => (n || '?').trim().charAt(0).toUpperCase();

  async function loadSdk() {
    if (window.firebase?.firestore) return;
    for (const f of ['firebase-app-compat', 'firebase-auth-compat', 'firebase-firestore-compat']) await loadScript(`lib/fb/${f}.js?v=10141`);
  }
  async function boot() {   // โหลด SDK และติดตามสถานะการเข้าสู่ระบบ
    if (!enabled()) { render(); return; }
    try {
      await loadSdk();
      if (!firebase.apps.length) { firebase.initializeApp(FB_CONFIG); try { await firebase.firestore().enablePersistence({ synchronizeTabs: true }); } catch {} }
      st.db = firebase.firestore();
      firebase.auth().getRedirectResult?.().catch(e => { st.err = authErr(e); render(); });
      firebase.auth().onAuthStateChanged(u => { st.authed = true; st.user = u && !u.isAnonymous ? u : null; st.user ? start() : (stop(), render()); });
    } catch (e) { st.err = navigator.onLine === false ? 'ออฟไลน์ — จะเชื่อมเมื่อมีเน็ต' : (e.message || String(e)); render(); }
  }
  const authErr = e => ({ 'auth/unauthorized-domain': 'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase (Authentication → Settings → Authorized domains)', 'auth/operation-not-allowed': 'ยังไม่ได้เปิดการเข้าสู่ระบบด้วย Google ใน Firebase', 'auth/network-request-failed': 'ต่อเน็ตไม่ได้ ลองใหม่อีกครั้ง' }[e.code] || e.message || String(e));
  async function login() {
    const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    try { await firebase.auth().signInWithPopup(p); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) return firebase.auth().signInWithRedirect(p);
      if (e.code !== 'auth/popup-closed-by-user') { st.err = authErr(e); render(); }
    }
  }
  async function logout() { stop(); await firebase.auth().signOut().catch(() => {}); st.admin = false; st.banned = false; render(); toast('ออกจากระบบแล้ว (หมุดในเครื่องยังอยู่ครบ)'); }
  async function start() {
    stop(); st.err = '';
    if (!st.user) { render(); return; }
    try {
      st.uid = st.user.uid;
      if (!st.me) { st.me = (st.user.displayName || '').trim().slice(0, 24); if (st.me) ls.set('myname', st.me); }
      st.admin = await st.db.collection('admins').doc(st.uid).get().then(d => d.exists).catch(() => false);
      st.banned = await st.db.collection('banned').doc(st.uid).get().then(d => d.exists).catch(() => false);
      if (!st.banned) col('members').doc(st.uid).set({ uid: st.uid, name: st.me || 'ไม่ระบุชื่อ', av: st.user.photoURL || '', seen: Date.now() }, { merge: true }).catch(() => {});
      const watch = (name, key, after) => st.unsub.push(col(name).onSnapshot(snap => {
        st[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!st.first[key]) { st.first[key] = true; after && after(); }
        render();
      }, e => { st.err = e.code === 'permission-denied' ? 'ฐานข้อมูลปฏิเสธการเข้าถึง (ตรวจกฎความปลอดภัยใน Firebase)' : (e.message || String(e)); render(); }));
      watch('pins', 'pins', () => syncAll('pins'));
      watch('catches', 'catches', () => syncAll('catches'));
      watch('members', 'members');
      if (st.admin) st.unsub.push(st.db.collection('banned').onSnapshot(s => { st.bannedList = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, () => {}));
      st.ready = true;
    } catch (e) { st.err = navigator.onLine === false ? 'ออฟไลน์ — จะเชื่อมเมื่อมีเน็ต' : (e.message || String(e)); }
    render();
  }
  function stop() { st.unsub.forEach(f => { try { f(); } catch {} }); st.unsub = []; st.ready = false; st.pins = []; st.catches = []; st.members = []; st.first = { pins: false, catches: false }; }

  /* ---------- ส่งของเราขึ้นกลุ่ม ---------- */
  function thumb(src, max = 360) {
    if (!src) return Promise.resolve(null);
    return new Promise(res => { const im = new Image(); im.onload = () => { const s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .6)); }; im.onerror = () => res(null); im.src = src; });
  }
  const spotDoc = s => ({ uid: st.uid, by: st.me || 'ไม่ระบุชื่อ', av: st.user?.photoURL || '', type: s.type, name: s.name, lat: s.lat, lng: s.lng, fish: s.fish || '', note: s.note || '', fee: s.fee || '', hours: s.hours || '', rules: s.rules || '', tel: s.tel || '' });
  const catchDoc = c => { const sp = S.spots.find(x => x.id === c.spotId); return { uid: st.uid, by: st.me || 'ไม่ระบุชื่อ', av: st.user?.photoURL || '', species: c.species, len: c.len ?? null, wt: c.wt ?? null, bait: c.bait || '', note: c.note || '', t: c.t, lat: c.lat ?? sp?.lat ?? null, lng: c.lng ?? sp?.lng ?? null, spot: sp?.name || '', released: !!c.released }; };
  async function push(kind, item) {
    if (!st.ready || st.banned) return;
    const remote = st[kind].find(x => x.id === item.id), key = kind + ':' + item.id;
    if (item.private) { if (remote && remote.uid === st.uid) { await col(kind).doc(item.id).delete().catch(() => {}); delete pushed[key]; ls.set('grpPushed', pushed); } return; }
    if (remote && remote.uid !== st.uid) return;                       // ไอดีชนกับของคนอื่น (แทบเป็นไปไม่ได้) ไม่ทับ
    const doc = kind === 'pins' ? spotDoc(item) : catchDoc(item), f = fp(doc) + ':' + (item.photo ? item.photo.length : 0);
    if (remote && pushed[key] === f) return;
    doc.photo = await thumb(item.photo, kind === 'catches' ? 900 : 480); doc.updated = Date.now();
    await col(kind).doc(item.id).set(doc).then(() => { pushed[key] = f; ls.set('grpPushed', pushed); }).catch(e => { st.err = e.message; render(); });
  }
  async function drop(kind, id) {
    if (!st.ready) return;
    const remote = st[kind].find(x => x.id === id);
    if (remote && remote.uid === st.uid) await col(kind).doc(id).delete().catch(() => {});
    delete pushed[kind + ':' + id]; ls.set('grpPushed', pushed);
  }
  async function syncAll(kind) {      // ส่งของที่ยังไม่ขึ้น และลบของเราที่ถูกลบในเครื่องไปแล้ว
    if (!st.ready || st.banned) return;
    const local = kind === 'pins' ? S.spots : S.catches, ids = new Set(local.map(x => x.id));
    for (const x of local) await push(kind, x);
    for (const r of st[kind]) if (r.uid === st.uid && !ids.has(r.id)) await col(kind).doc(r.id).delete().catch(() => {});
  }

  /* ---------- แอดมิน ---------- */
  async function adminDel(kind, id) { if (!st.admin) return; await col(kind).doc(id).delete().then(() => toast('ลบแล้ว')).catch(e => toast('ลบไม่ได้: ' + e.message)); }
  async function ban(uid, name, on) {
    if (!st.admin || uid === st.uid) return;
    const ref = st.db.collection('banned').doc(uid);
    await (on ? ref.set({ uid, name: name || '', by: st.uid, t: Date.now() }) : ref.delete()).then(() => toast(on ? 'แบนแล้ว คนนี้ปักหมุดหรือแก้อะไรไม่ได้อีก' : 'ปลดแบนแล้ว')).catch(e => toast(e.message));
  }
  async function wipe(uid) { if (!st.admin) return; let n = 0; for (const k of ['pins', 'catches']) for (const x of st[k].filter(x => x.uid === uid)) { await col(k).doc(x.id).delete().catch(() => {}); n++; } toast(`ลบแล้ว ${n} รายการ`); }
  const armBtn = (el, label, fn) => { let a = false; el.onclick = e => { if (!a) { a = true; e.currentTarget.textContent = label; return; } fn(); }; };

  /* ---------- ของเพื่อน ---------- */
  const friendPins = () => st.user ? st.pins.filter(p => p.uid !== st.uid) : [];
  const friendCatches = () => (st.user ? st.catches : []).filter(c => c.uid !== st.uid).sort((a, b) => b.t - a.t);
  function renderMap() {
    layer.clearLayers();
    if (OPT.friends === false) return;
    friendPins().filter(p => !OPT.types || OPT.types.includes(p.type)).forEach(p => {
      const t = SPOT_TYPES[p.type] || SPOT_TYPES.other;
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="mk friend" style="background:${t.color}"><span>${t.icon}</span><em>${esc(initial(p.by))}</em></div>`, iconSize: [34, 34], iconAnchor: [17, 34] }) }).on('click', () => pinSheet(p.id)).addTo(layer);
    });
  }
  function pinSheet(id) {
    const p = st.pins.find(x => x.id === id); if (!p) return;
    const t = SPOT_TYPES[p.type] || SPOT_TYPES.other, n = st.catches.filter(c => c.lat != null && dist(c, p) < 150).length;
    openSheet(`<h3>${t.icon} ${esc(p.name)}</h3>
    <div class="sub">👥 หมุดของ ${esc(p.by)} · ${t.label}${S.pos ? ' · ห่าง ' + fmtDist(dist(S.pos, p)) : ''}</div>
    ${p.photo ? `<img class="photo-prev" src="${p.photo}">` : ''}
    <div class="kv"><span>พิกัด</span><b class="mono">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</b>
      ${p.fish ? `<span>ปลา</span><b>${esc(p.fish)}</b>` : ''}${p.note ? `<span>โน้ต</span><b>${esc(p.note)}</b>` : ''}
      ${p.fee ? `<span>ค่าบริการ</span><b>${esc(p.fee)}</b>` : ''}${p.hours ? `<span>เปิด–ปิด</span><b>${esc(p.hours)}</b>` : ''}${p.rules ? `<span>กฎ/ข้อห้าม</span><b style="color:var(--warn-tx)">⚠️ ${esc(p.rules)}</b>` : ''}${p.tel ? `<span>ติดต่อ</span><b><a href="tel:${esc(p.tel.replace(/[^0-9+]/g, ''))}" style="color:var(--link)">${esc(p.tel)}</a></b>` : ''}
      ${n ? `<span>ปลาของทุกคนแถวนี้</span><b>${n} ตัว</b>` : ''}<span>อัปเดต</span><b>${p.updated ? new Date(p.updated).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-'}</b></div>
    <div class="row">
      <button class="btn acc" id="fpNav">🧭 นำทางด้วยเข็มทิศ</button>
      <a class="btn ghost" href="${gmaps(p)}" target="_blank" rel="noopener">Google Maps</a>
      ${svBtn(p)}
      <button class="btn ghost" id="fpFc">🌤️ พยากรณ์ที่นี่</button>
      <button class="btn ghost" id="fpCopy">📍 เก็บเป็นหมุดของฉัน</button>
      ${st.admin ? '<button class="btn danger" id="fpDel">ลบหมุดนี้ (แอดมิน)</button>' : ''}
    </div>`);
    if (st.admin) armBtn($('#fpDel'), 'แตะอีกครั้งเพื่อลบหมุดของ ' + p.by, () => { adminDel('pins', p.id); closeSheet(); });
    $('#fpNav').onclick = () => { setTarget({ lat: p.lat, lng: p.lng, name: p.name }); closeSheet(); showTab('tools'); };
    $('#fpFc').onclick = () => { closeSheet(); loadForecast({ lat: p.lat, lng: p.lng, name: p.name }); showTab('forecast'); };
    $('#fpCopy').onclick = () => spotForm({ private: true, lat: p.lat, lng: p.lng, type: p.type, name: p.name, fish: p.fish, note: p.note, fee: p.fee, hours: p.hours, rules: p.rules, tel: p.tel });
    map.panTo([p.lat, p.lng]);
  }
  function catchSheetF(id) {
    const c = st.catches.find(x => x.id === id); if (!c) return;
    const dt = new Date(c.t);
    openSheet(`<h3>🐟 ${esc(c.species)}</h3>
    <div class="sub">👥 ${esc(c.by)} · ${dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} ${hm(dt)}${c.released ? ' · ปล่อยคืนน้ำ' : ''}</div>
    ${c.photo ? `<img class="photo-prev" src="${c.photo}">` : ''}
    <div class="kv">${c.len ? `<span>ยาว</span><b>${c.len} ซม.</b>` : ''}${c.wt ? `<span>หนัก</span><b>${c.wt} กก.</b>` : ''}${c.bait ? `<span>เหยื่อ</span><b>${esc(c.bait)}</b>` : ''}
      ${c.spot ? `<span>จุด</span><b>${esc(c.spot)}</b>` : ''}${c.lat != null ? `<span>พิกัด</span><b class="mono">${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</b>` : ''}${c.note ? `<span>โน้ต</span><b>${esc(c.note)}</b>` : ''}</div>
    <div class="row">${c.lat != null ? `<button class="btn acc" id="fcMap">🗺️ ดูบนแผนที่</button><button class="btn ghost" id="fcNav">🧭 นำทางไปจุดนี้</button>` : ''}${st.admin ? '<button class="btn danger" id="fcDel">ลบ (แอดมิน)</button>' : ''}</div>`);
    if (st.admin) armBtn($('#fcDel'), 'แตะอีกครั้งเพื่อลบ', () => { adminDel('catches', c.id); closeSheet(); });
    if (c.lat != null) {
      $('#fcMap').onclick = () => { closeSheet(); showTab('map'); S.follow = false; map.setView([c.lat, c.lng], 15); };
      $('#fcNav').onclick = () => { setTarget({ lat: c.lat, lng: c.lng, name: c.species + ' ของ ' + c.by }); closeSheet(); showTab('tools'); };
    }
  }

  /* ---------- หน้ากลุ่มในแท็บบันทึก ---------- */
  const avatar = (url, name, cls = 'av') => url ? `<i class="${cls}" style="background-image:url('${esc(url)}')"></i>` : `<i class="${cls}">${esc(initial(name))}</i>`;
  const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 60 ? Math.max(1, m) + ' นาทีที่แล้ว' : m < 1440 ? Math.round(m / 60) + ' ชม.ที่แล้ว' : m < 10080 ? Math.round(m / 1440) + ' วันที่แล้ว' : new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); };
  let tambons = null; loadTambons().then(T => { tambons = T; renderFeed(); });
  const placeOf = c => { if (c.spot) return c.spot; if (!tambons || c.lat == null) return ''; let b = null, bd = 1e12; for (const t of tambons) { if (Math.abs(t[0] - c.lat) > .2 || Math.abs(t[1] - c.lng) > .2) continue; const d = dist(c, { lat: t[0], lng: t[1] }); if (d < bd) { bd = d; b = t; } } return b ? `${b[2]} · ${b[3]}` : ''; };
  let feedMode = 'all';
  function render() { renderMap(); renderProfile(); renderCommunity(); renderFeed(); }
  function renderProfile() {
    const el = $('#profileBox'); if (!el) return;
    if (!enabled()) { el.innerHTML = `${avatar('', 'ฉัน', 'av big')}<div class="pinfo"><b>สมุดบันทึกของฉัน</b></div>`; return; }
    if (!st.user) {
      el.innerHTML = `${avatar('', '?', 'av big')}<div class="pinfo"><b>ยังไม่เข้าสู่ระบบ</b><span class="sub">เข้าสู่ระบบเพื่อแชร์หมุดและปลาในชุมชน</span><button class="btn small" id="pLogin" ${st.authed ? '' : 'disabled'}>เข้าสู่ระบบด้วย Google</button></div>`;
      $('#pLogin').onclick = () => { st.err = ''; login(); };
      return;
    }
    el.innerHTML = `${avatar(st.user.photoURL, st.me, 'av big')}<div class="pinfo"><b>${esc(st.me || 'ไม่ระบุชื่อ')}${st.admin ? ' <span class="adm">แอดมิน</span>' : ''}</b><span class="sub">${esc(st.user.email || '')}</span>
      <div class="plinks"><button class="link" id="pName">เปลี่ยนชื่อ</button><button class="link" id="pOut">ออกจากระบบ</button>${st.admin ? '' : '<button class="link" id="pUid">รหัสผู้ใช้</button>'}</div></div>`;
    $('#pName').onclick = renameSheet; $('#pOut').onclick = logout;
    if ($('#pUid')) $('#pUid').onclick = () => copy(st.uid, 'คัดลอกรหัสผู้ใช้แล้ว');
  }
  function renderCommunity() {
    const el = $('#groupCard'); if (!el) return;
    $('#feedSeg')?.classList.toggle('hidden', !st.user);
    if (!enabled()) { el.innerHTML = '<div class="sub">ยังไม่ได้เชื่อมเซิร์ฟเวอร์</div>'; return; }
    if (!st.user) {
      el.innerHTML = `<div style="font-weight:600;font-size:17px">ดูปลาและจุดตกปลาของทุกคน</div><div class="sub" style="margin-top:4px">เข้าสู่ระบบเพื่อเห็นโพสต์ปลาของคนอื่น และแชร์ของคุณ</div>
        ${st.err ? `<div class="warn" style="margin:10px 0 0">${esc(st.err)}</div>` : ''}
        <div class="row"><button class="btn" id="gLogin" ${st.authed ? '' : 'disabled'}>เข้าสู่ระบบด้วย Google</button></div>`;
      $('#gLogin').onclick = () => { st.err = ''; login(); };
      return;
    }
    el.innerHTML = `<div class="grp-h"><div><b>${st.members.length || '-'} คนในชุมชน</b><div class="sub">${st.ready ? (navigator.onLine === false ? 'ออฟไลน์ · จะซิงก์เมื่อมีเน็ต' : 'เชื่อมแล้ว') : st.err ? '' : 'กำลังเชื่อม…'} · หมุด ${friendPins().length} จุดจากคนอื่น</div></div><div class="mstack">${st.members.slice(0, 5).map(m => avatar(m.av, m.name)).join('')}</div></div>
      ${st.banned ? '<div class="warn" style="margin:10px 0 0">บัญชีนี้ถูกระงับการแชร์ หมุดและปลาของคุณจะไม่ถูกส่งขึ้นไป</div>' : ''}
      ${st.err ? `<div class="warn" style="margin:10px 0 0">${esc(st.err)}</div>` : ''}
      ${st.admin ? adminHtml() : ''}`;
    $$('#groupCard [data-ban]').forEach(b => b.onclick = () => { const m = st.members.find(x => x.uid === b.dataset.ban) || st.bannedList.find(x => x.id === b.dataset.ban); ban(b.dataset.ban, m?.name, b.dataset.on === '1'); });
    $$('#groupCard [data-wipe]').forEach(b => armBtn(b, 'แตะอีกครั้ง: ลบทั้งหมดของคนนี้', () => wipe(b.dataset.wipe)));
  }
  function renderFeed() {
    const el = $('#feedList'); if (!el) return;
    if (!st.user) { el.innerHTML = ''; return; }
    const posts = st.catches.filter(c => feedMode === 'all' || c.uid === st.uid).sort((a, b) => b.t - a.t).slice(0, 60);
    if (!posts.length) { el.innerHTML = `<div class="empty">${feedMode === 'mine' ? 'ยังไม่มีปลาที่แชร์ กด ＋ เพื่อบันทึกปลาตัวแรก' : 'ยังไม่มีใครโพสต์ปลา เป็นคนแรกเลย กด ＋ บันทึกปลา'}</div>`; return; }
    el.innerHTML = posts.map(c => { const m = st.members.find(x => x.uid === c.uid), name = c.uid === st.uid ? (st.me || c.by) : (m?.name || c.by), av = c.av || m?.av, place = placeOf(c);
      return `<article class="post" data-post="${c.id}">
        <header>${avatar(av, name)}<div><b>${esc(name)}</b><span class="sub">${esc(c.species)}${place ? ' · ' + esc(place) : ''}</span></div>${c.uid === st.uid || st.admin ? `<button class="pmore" data-pmore="${c.id}" aria-label="เพิ่มเติม">⋮</button>` : ''}</header>
        ${c.photo ? `<img class="pimg" loading="lazy" src="${c.photo}" alt="">` : `<div class="pimg none">🐟</div>`}
        <div class="pbody"><b>${esc(c.species)}${c.wt ? ` ${c.wt} กก.` : ''}${c.len ? ` · ${c.len} ซม.` : ''}</b>${c.bait ? `<span class="sub"> · เหยื่อ ${esc(c.bait)}</span>` : ''}${c.released ? '<span class="sub"> · ปล่อยคืนน้ำ</span>' : ''}
          ${c.note ? `<p>${esc(c.note)}</p>` : ''}<div class="sub">${ago(c.t)}${c.lat != null ? ` · <button class="link" data-pmap="${c.id}">ดูบนแผนที่</button>` : ''}</div></div></article>`; }).join('');
    $$('#feedList [data-post] .pimg').forEach(x => x.onclick = () => openPost(x.closest('[data-post]').dataset.post));
    $$('#feedList [data-pmap]').forEach(b => b.onclick = () => { const c = st.catches.find(x => x.id === b.dataset.pmap); if (!c) return; showTab('map'); S.follow = false; map.setView([c.lat, c.lng], 15); });
    $$('#feedList [data-pmore]').forEach(b => b.onclick = () => openPost(b.dataset.pmore));
  }
  function openPost(id) {
    const c = st.catches.find(x => x.id === id); if (!c) return;
    if (c.uid === st.uid && S.catches.some(x => x.id === id)) return catchSheet(id);
    catchSheetF(id);
  }
  $$('#feedSeg [data-feed]').forEach(b => b.onclick = () => { feedMode = b.dataset.feed; $$('#feedSeg button').forEach(x => x.classList.toggle('sel', x === b)); renderFeed(); });
  $('#feedInv')?.addEventListener('click', () => invite());
  function adminHtml() {
    const banned = new Set(st.bannedList.map(b => b.id));
    const rows = st.members.filter(m => m.uid !== st.uid).map(m => {
      const np = st.pins.filter(p => p.uid === m.uid).length, nc = st.catches.filter(c => c.uid === m.uid).length, isB = banned.has(m.uid);
      return `<div class="adm-row"><div><b>${esc(m.name || 'ไม่ระบุชื่อ')}</b>${isB ? ' <span class="adm ban">ถูกแบน</span>' : ''}<div class="sub">หมุด ${np} · ปลา ${nc}${m.seen ? ' · ล่าสุด ' + new Date(m.seen).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : ''}</div></div>
        <div class="adm-act"><button class="btn small ${isB ? 'ghost' : 'danger'}" data-ban="${m.uid}" data-on="${isB ? 0 : 1}">${isB ? 'ปลดแบน' : 'แบน'}</button>${np + nc ? `<button class="btn small ghost" data-wipe="${m.uid}">ลบทั้งหมด</button>` : ''}</div></div>`;
    }).join('');
    return `<div class="card-h" style="margin-top:16px;font-size:15px">จัดการผู้ใช้ (แอดมิน)</div>${rows || '<div class="sub">ยังไม่มีผู้ใช้อื่น</div>'}<div class="sub" style="margin-top:6px">แตะหมุดหรือปลาของใครก็ได้ เพื่อลบทีละรายการ</div>`;
  }
  function setMe() { const v = ($('#gMe')?.value || '').trim().slice(0, 24); if (!v) { toast('ใส่ชื่อของคุณก่อน เพื่อนจะได้รู้ว่าหมุดเป็นของใคร'); $('#gMe')?.focus(); return false; } st.me = v; ls.set('myname', v); return true; }
  function afterRename() {   // ชื่อเปลี่ยน: อัปเดตชื่อบนหมุด/ปลาที่แชร์ไปแล้ว
    Object.keys(pushed).forEach(k => delete pushed[k]); ls.set('grpPushed', pushed);
    if (st.ready && !st.banned) { col('members').doc(st.uid).set({ uid: st.uid, name: st.me, seen: Date.now() }, { merge: true }).catch(() => {}); syncAll('pins'); syncAll('catches'); }
  }
  async function invite() {
    const link = `${location.origin}${location.pathname}`;
    const text = `มาใช้พรานปลากัน แอปแผนที่ตกปลา เห็นหมุดตกปลาของกันและกัน\n${link}`;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copy(text, 'คัดลอกลิงก์แล้ว ส่งทาง LINE ได้เลย');
  }
  function renameSheet() {
    openSheet(`<h3>เปลี่ยนชื่อ</h3><div class="form"><label>ชื่อของคุณ</label><input id="gMe" value="${esc(st.me)}"></div><div class="row"><button class="btn block acc" id="rnSave">บันทึก</button></div>`);
    $('#rnSave').onclick = () => { if (!setMe()) return; afterRename(); closeSheet(); render(); };
  }

  window.addEventListener('online', () => { if (!st.db) boot(); else if (st.user && !st.ready) start(); else render(); });
  window.addEventListener('offline', render);
  if (/^#join=/.test(location.hash)) history.replaceState(null, '', location.pathname);   // ลิงก์ชวนรุ่นเก่า
  setTimeout(boot, 0);

  return {
    pushSpot: s => push('pins', s), delSpot: id => drop('pins', id),
    pushCatch: c => push('catches', c), delCatch: id => drop('catches', id),
    syncAll: () => { syncAll('pins'); syncAll('catches'); },
    renderMap, render, pinSheet, catchSheet: catchSheetF,
    get joined() { return enabled() && !!st.user; },
    friendPins, friendCatches, st
  };
})();
