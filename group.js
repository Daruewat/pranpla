'use strict';
/* ============ ชุมชน: ผู้ใช้ที่เข้าสู่ระบบ (Google) เห็นหมุดและปลาที่จับได้ของกันและกัน (Firebase: Firestore + Auth) ============
   โครงข้อมูล: groups/all/members/{uid} · pins/{id} · catches/{id} · admins/{uid} (สร้างเองใน Console) · banned/{uid}
   ทุกเอกสารมี uid ของเจ้าของ กฎฐานข้อมูล (firestore.rules): แก้/ลบได้เฉพาะของตัวเอง แอดมินจัดการได้ทั้งหมด */
const GRP = (() => {
  const st = { gid: 'all', gname: 'ชุมชนพรานปลา', me: ls.get('myname', ''), uid: null, user: null, admin: false, banned: false, bannedList: [], db: null, ready: false, authed: false, err: '', pins: [], catches: [], members: [], likes: [], comments: [], unsub: [], first: { pins: false, catches: false } };
  const layer = L.layerGroup().addTo(map);
  const pushed = ls.get('grpPushed', {});           // id → ลายนิ้วมือของข้อมูลที่ส่งขึ้นไปล่าสุด กันส่งซ้ำ
  const enabled = () => !!(window.FB_CONFIG && FB_CONFIG.apiKey);
  const col = n => st.db.collection('groups').doc(st.gid).collection(n);
  const fp = o => { const s = JSON.stringify(o); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + h; };
  const initial = n => (n || '?').trim().charAt(0).toUpperCase();
  const myAv = () => ls.get('myAv', '') || st.user?.photoURL || '';            // รูปโปรไฟล์ที่ตั้งเอง ไม่มีก็ใช้รูป Google
  const docAv = () => ls.get('myAv', '') ? '' : (st.user?.photoURL || '');      // ในโพสต์เก็บแค่ลิงก์ Google รูปที่ตั้งเองอ่านจากข้อมูลสมาชิก (ไม่ให้โพสต์ใหญ่)

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
  async function logout() { stop(); ls.set('myAv', ''); await firebase.auth().signOut().catch(() => {}); st.admin = false; st.banned = false; render(); toast('ออกจากระบบแล้ว (หมุดในเครื่องยังอยู่ครบ)'); }
  async function start() {
    stop(); st.err = '';
    if (!st.user) { render(); return; }
    try {
      st.uid = st.user.uid;
      if (!st.me) { st.me = (st.user.displayName || '').trim().slice(0, 24); if (st.me) ls.set('myname', st.me); }
      st.admin = await st.db.collection('admins').doc(st.uid).get().then(d => d.exists).catch(() => false);
      st.banned = await st.db.collection('banned').doc(st.uid).get().then(d => d.exists).catch(() => false);
      const md = await col('members').doc(st.uid).get().then(d => d.exists ? d.data() : null).catch(() => null);   // รูปที่ตั้งไว้จากเครื่องอื่น
      if (!ls.get('myAv', '') && /^data:/.test(md?.av || '')) ls.set('myAv', md.av);
      if (!st.banned) col('members').doc(st.uid).set({ uid: st.uid, name: st.me || 'ไม่ระบุชื่อ', av: myAv(), seen: Date.now() }, { merge: true }).catch(() => {});
      const watch = (name, key, after, each) => st.unsub.push(col(name).onSnapshot(snap => {
        st[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!st.first[key]) { st.first[key] = true; after && after(); }
        each && each();
        render();
      }, e => { st.err = e.code === 'permission-denied' ? 'ฐานข้อมูลปฏิเสธการเข้าถึง (ตรวจกฎความปลอดภัยใน Firebase)' : (e.message || String(e)); render(); }));
      watch('pins', 'pins', () => syncAll('pins'));
      watch('catches', 'catches', () => syncAll('catches'));
      watch('members', 'members');
      watch('likes', 'likes');
      watch('comments', 'comments', null, () => { if (cmOpen) renderComments(); });
      if (st.admin) st.unsub.push(st.db.collection('banned').onSnapshot(s => { st.bannedList = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, () => {}));
      st.ready = true;
    } catch (e) { st.err = navigator.onLine === false ? 'ออฟไลน์ — จะเชื่อมเมื่อมีเน็ต' : (e.message || String(e)); }
    render();
  }
  function stop() { st.unsub.forEach(f => { try { f(); } catch {} }); st.unsub = []; st.ready = false; st.pins = []; st.catches = []; st.members = []; st.likes = []; st.comments = []; st.first = { pins: false, catches: false }; }

  /* ---------- ส่งของเราขึ้นกลุ่ม ---------- */
  function thumb(src, max = 360) {
    if (!src) return Promise.resolve(null);
    return new Promise(res => { const im = new Image(); im.onload = () => { const s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .6)); }; im.onerror = () => res(null); im.src = src; });
  }
  const spotDoc = s => ({ uid: st.uid, by: st.me || 'ไม่ระบุชื่อ', av: docAv(), type: s.type, name: s.name, lat: s.lat, lng: s.lng, fish: s.fish || '', note: s.note || '', fee: s.fee || '', hours: s.hours || '', rules: s.rules || '', tel: s.tel || '' });
  const catchDoc = c => { const sp = S.spots.find(x => x.id === c.spotId); return { uid: st.uid, by: st.me || 'ไม่ระบุชื่อ', av: docAv(), species: c.species, len: c.len ?? null, wt: c.wt ?? null, bait: c.bait || '', note: c.note || '', t: c.t, lat: c.lat ?? sp?.lat ?? null, lng: c.lng ?? sp?.lng ?? null, spot: sp?.name || '', released: !!c.released }; };
  let shareOk = !!ls.get('shareOk', false);   // ผู้ใช้ยืนยันแล้วว่ายอมแชร์ของที่มีอยู่ในเครื่อง
  async function push(kind, item) {
    if (!st.ready || st.banned || !shareOk) return;
    const remote = st[kind].find(x => x.id === item.id), key = kind + ':' + item.id;
    if (item.private) { if (remote && remote.uid === st.uid) { await col(kind).doc(item.id).delete().catch(() => {}); delete pushed[key]; ls.set('grpPushed', pushed); } return; }
    if (remote && remote.uid !== st.uid) return;                       // ไอดีชนกับของคนอื่น (แทบเป็นไปไม่ได้) ไม่ทับ
    const doc = kind === 'pins' ? spotDoc(item) : catchDoc(item), f = fp(doc) + ':' + (item.photo ? item.photo.length : 0);
    if (remote && pushed[key] === f) return;
    doc.photo = await thumb(item.photo, kind === 'catches' ? 900 : 480); doc.updated = Date.now();
    await col(kind).doc(item.id).set(doc).then(() => { pushed[key] = f; ls.set('grpPushed', pushed); }).catch(e => { st.err = e.message; render(); });
  }
  const tomb = ls.get('grpDeleted', {});   // ของเราที่ลบในเครื่องนี้ กันดึงกลับมาจากเซิร์ฟเวอร์
  async function drop(kind, id) {
    tomb[kind + ':' + id] = Date.now(); ls.set('grpDeleted', tomb);
    if (!st.ready) return;
    const remote = st[kind].find(x => x.id === id);
    if (remote && remote.uid === st.uid) { if (kind === 'catches') await clearReactions(id); await col(kind).doc(id).delete().catch(() => {}); }
    delete pushed[kind + ':' + id]; ls.set('grpPushed', pushed);
  }
  async function syncAll(kind) {      // ส่งของในเครื่องที่ยังไม่ขึ้น และดึงของเราจากเซิร์ฟเวอร์ที่เครื่องนี้ไม่มี (เช่น เปลี่ยนเครื่อง/ล้างเบราว์เซอร์)
    if (!st.ready) return;
    const local = kind === 'pins' ? S.spots : S.catches, ids = new Set(local.map(x => x.id));
    const back = st[kind].filter(r => r.uid === st.uid && !ids.has(r.id) && !tomb[kind + ':' + r.id]);
    if (back.length) {
      back.forEach(r => { const { uid, by, av, updated, ...x } = r; if (kind === 'pins') S.spots.push(x); else { if (x.spot && !S.spots.some(s => s.name === x.spot)) x.note = [x.note, 'จุด: ' + x.spot].filter(Boolean).join(' · '); delete x.spot; S.catches.push(x); } });
      if (kind === 'catches') S.catches.sort((a, b) => b.t - a.t);
      save(kind === 'pins' ? 'spots' : 'catches'); renderSpots(); renderLog();
      toast(`กู้${kind === 'pins' ? 'หมุด' : 'ปลา'}ของคุณจากเซิร์ฟเวอร์ ${back.length} รายการ`);
    }
    if (st.banned) return;
    if (!shareOk) { askShare(); return; }
    for (const x of local) await push(kind, x);
  }
  let asked = false;
  function askShare() {   // ครั้งแรกที่ล็อกอิน: ถามก่อนแชร์ของเดิมทั้งหมด
    if (asked) return; asked = true;
    const srv = k => new Set(st[k].filter(r => r.uid === st.uid).map(r => r.id)), sp = srv('pins'), sc = srv('catches');
    const ps = S.spots.filter(s => !s.private && !sp.has(s.id)).length, cs = S.catches.filter(c => !c.private && !sc.has(c.id)).length;
    if (!ps && !cs) { shareOk = true; ls.set('shareOk', true); return; }
    openSheet(`<h3>แชร์ของที่มีอยู่แล้ว?</h3><div class="sub" style="color:var(--tx)">ในเครื่องนี้มีหมุด ${ps} จุด และปลา ${cs} ตัว ที่ยังไม่ได้ตั้งเป็นส่วนตัว ถ้าแชร์ ทุกคนที่ล็อกอินจะเห็น รวมโน้ตและรูป</div>
      <div class="row" style="flex-direction:column;align-items:stretch"><button class="btn" id="shAll">แชร์ทั้งหมด (ยกเว้นที่ตั้งส่วนตัวไว้)</button><button class="btn ghost" id="shNone">ตั้งของเดิมทั้งหมดเป็นส่วนตัวก่อน แล้วค่อยเลือกเปิดเอง</button></div>
      <div class="sub" style="margin-top:8px">หมุดและปลาที่บันทึกใหม่หลังจากนี้จะแชร์อัตโนมัติ ยกเว้นที่ติ๊กส่วนตัว</div>`);
    const go = async priv => {
      const onSrv = k => new Set(st[k].filter(r => r.uid === st.uid).map(r => r.id));   // ของที่อยู่บนเซิร์ฟเวอร์แล้วไม่ต้องแตะ
      if (priv) { const p = onSrv('pins'), c2 = onSrv('catches'); S.spots.forEach(s => { if (!p.has(s.id)) s.private = true; }); S.catches.forEach(c => { if (!c2.has(c.id)) c.private = true; }); save('spots'); save('catches'); renderSpots(); renderLog(); }
      shareOk = true; ls.set('shareOk', true); closeSheet(); await syncAll('pins'); await syncAll('catches');
      toast(priv ? 'ตั้งเป็นส่วนตัวแล้ว เปิดแชร์ทีละอันได้ในหน้าแก้ไขหมุด/ปลา' : 'แชร์แล้ว');
    };
    $('#shAll').onclick = () => go(false); $('#shNone').onclick = () => go(true);
  }

  /* ---------- แอดมิน ---------- */
  async function clearReactions(post) { for (const k of ['likes', 'comments']) for (const x of st[k].filter(x => x.post === post)) await col(k).doc(x.id).delete().catch(() => {}); }
  async function adminDel(kind, id) { if (!st.admin) return; if (kind === 'catches') await clearReactions(id); await col(kind).doc(id).delete().then(() => toast('ลบแล้ว')).catch(e => toast('ลบไม่ได้: ' + e.message)); }
  async function ban(uid, name, on) {
    if (!st.admin || uid === st.uid) return;
    const ref = st.db.collection('banned').doc(uid);
    await (on ? ref.set({ uid, name: name || '', by: st.uid, t: Date.now() }) : ref.delete()).then(() => toast(on ? 'แบนแล้ว คนนี้ปักหมุดหรือแก้อะไรไม่ได้อีก' : 'ปลดแบนแล้ว')).catch(e => toast(e.message));
  }
  async function wipe(uid) { if (!st.admin) return; let n = 0; for (const k of ['pins', 'catches', 'comments', 'likes']) for (const x of st[k].filter(x => x.uid === uid)) { if (k === 'catches') await clearReactions(x.id); await col(k).doc(x.id).delete().catch(() => {}); if (k !== 'likes') n++; } toast(`ลบแล้ว ${n} รายการ`); }
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
    <div class="row"><button class="btn ghost" id="fcCm">ความคิดเห็น ${st.comments.filter(x => x.post === c.id).length || ''}</button>${c.lat != null ? `<button class="btn acc" id="fcMap">🗺️ ดูบนแผนที่</button><button class="btn ghost" id="fcNav">🧭 นำทางไปจุดนี้</button>` : ''}${st.admin ? '<button class="btn danger" id="fcDel">ลบ (แอดมิน)</button>' : ''}</div>`);
    $('#fcCm').onclick = () => openComments(c.id);
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
    el.innerHTML = `<button class="avedit" id="pAv" aria-label="เปลี่ยนรูปโปรไฟล์">${avatar(myAv(), st.me, 'av big')}<span class="avpen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg></span></button><div class="pinfo"><b>${esc(st.me || 'ไม่ระบุชื่อ')}${st.admin ? ' <span class="adm">แอดมิน</span>' : ''}</b><span class="sub">${esc(st.user.email || '')}</span>
      <div class="plinks"><button class="link" id="pName">เปลี่ยนชื่อ</button><button class="link" id="pOut">ออกจากระบบ</button>${st.admin ? '' : '<button class="link" id="pUid">รหัสผู้ใช้</button>'}</div></div>`;
    $('#pName').onclick = renameSheet; $('#pOut').onclick = logout; $('#pAv').onclick = avSheet;
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
    const note = [st.banned ? 'บัญชีนี้ถูกระงับการแชร์ หมุดและปลาของคุณจะไม่ถูกส่งขึ้นไป' : '', st.err, !st.ready && !st.err ? 'กำลังเชื่อม…' : navigator.onLine === false ? 'ออฟไลน์ · จะซิงก์เมื่อมีเน็ต' : ''].filter(Boolean);
    el.classList.toggle('hidden', !note.length && !st.admin);
    el.innerHTML = `${note.map(n => `<div class="warn" style="margin:0 0 8px">${esc(n)}</div>`).join('')}${st.admin ? adminHtml() : ''}`;
    $$('#groupCard [data-ban]').forEach(b => b.onclick = () => { const m = st.members.find(x => x.uid === b.dataset.ban) || st.bannedList.find(x => x.id === b.dataset.ban); ban(b.dataset.ban, m?.name, b.dataset.on === '1'); });
    $$('#groupCard [data-wipe]').forEach(b => armBtn(b, 'แตะอีกครั้ง: ลบทั้งหมดของคนนี้', () => wipe(b.dataset.wipe)));
  }
  const SVG_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3S3.5 15 3.5 9.1A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.5 2.5C20.5 15 12 20.3 12 20.3Z"/></svg>';
  const SVG_CM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4Z"/></svg>';
  const SVG_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  const likesOf = id => st.likes.filter(l => l.post === id);
  const cmsOf = id => st.comments.filter(c => c.post === id).sort((a, b) => a.t - b.t);
  const iLike = id => st.likes.some(l => l.post === id && l.uid === st.uid);
  const nameOf = (uid, fb) => uid === st.uid ? (st.me || fb) : (st.members.find(x => x.uid === uid)?.name || fb);
  const avOf = (uid, fb) => (uid === st.uid ? myAv() : st.members.find(x => x.uid === uid)?.av) || fb;
  async function toggleLike(id) {
    if (!st.ready) return toast('ยังไม่ได้เชื่อมต่อ');
    if (st.banned) return toast('บัญชีนี้ถูกระงับ');
    const lid = id + '_' + st.uid, ref = col('likes').doc(lid);
    if (iLike(id)) { st.likes = st.likes.filter(l => l.id !== lid); renderFeed(); await ref.delete().catch(e => toast(e.message)); }
    else { st.likes.push({ id: lid, uid: st.uid, post: id, t: Date.now() }); renderFeed(); await ref.set({ uid: st.uid, post: id, t: Date.now() }).catch(e => toast(e.message)); }
  }
  /* ความคิดเห็น */
  let cmOpen = null;
  function openComments(id) {
    const c = st.catches.find(x => x.id === id); if (!c) return;
    cmOpen = id;
    openSheet(`<h3>ความคิดเห็น</h3><div class="sub">${esc(c.species)} ของ ${esc(nameOf(c.uid, c.by))}</div>
      <div class="cmlist" id="cmList"></div>
      ${st.banned ? '<div class="warn">บัญชีนี้ถูกระงับ แสดงความคิดเห็นไม่ได้</div>' : `<form class="cmform" id="cmForm"><input id="cmIn" maxlength="300" placeholder="เขียนความคิดเห็น…" autocomplete="off" enterkeyhint="send"><button class="btn" id="cmSend">ส่ง</button></form>`}`);
    renderComments();
    const f = $('#cmForm'); if (f) f.onsubmit = e => { e.preventDefault(); sendComment(id); };
  }
  function renderComments() {
    const el = $('#cmList'); if (!el || !cmOpen) return;
    const post = st.catches.find(x => x.id === cmOpen), list = cmsOf(cmOpen);
    el.innerHTML = list.length ? list.map(m => { const can = m.uid === st.uid || st.admin || post?.uid === st.uid;
      return `<div class="cm">${avatar(avOf(m.uid, m.av), nameOf(m.uid, m.by))}<div class="cmb"><div><b>${esc(nameOf(m.uid, m.by))}</b> <span class="sub">${ago(m.t)}</span></div><p>${esc(m.text)}</p></div>${can ? `<button class="cmdel" data-cmdel="${m.id}" aria-label="ลบความคิดเห็น">ลบ</button>` : ''}</div>`; }).join('')
      : '<div class="empty small">ยังไม่มีความคิดเห็น เริ่มคุยเป็นคนแรก</div>';
    $$('#cmList [data-cmdel]').forEach(b => armBtn(b, 'ลบเลย?', () => col('comments').doc(b.dataset.cmdel).delete().catch(e => toast(e.message))));
    el.scrollTop = el.scrollHeight;
  }
  async function sendComment(id) {
    const inp = $('#cmIn'), text = (inp?.value || '').trim().slice(0, 300); if (!text) return;
    if (!st.ready) return toast('ยังไม่ได้เชื่อมต่อ');
    inp.value = '';
    await col('comments').add({ uid: st.uid, by: st.me || 'ไม่ระบุชื่อ', av: docAv(), post: id, text, t: Date.now() }).catch(e => { inp.value = text; toast('ส่งไม่ได้: ' + e.message); });
  }
  /* จุดแจ้งเตือนบนแท็บชุมชน: มีคนไลก์/คอมเมนต์ปลาของเราตั้งแต่เปิดดูครั้งล่าสุด */
  function badge() {
    const seen = ls.get('feedSeen', 0), mine = new Set(st.catches.filter(c => c.uid === st.uid).map(c => c.id));
    const n = [...st.likes, ...st.comments].filter(x => x.uid !== st.uid && mine.has(x.post) && x.t > seen).length;
    const tab = document.querySelector('.tabbar [data-tab=feed]'); if (!tab) return;
    if ($('#view-feed')?.classList.contains('show') && n) { ls.set('feedSeen', Date.now()); return tab.removeAttribute('data-n'); }
    n ? tab.setAttribute('data-n', n > 9 ? '9+' : n) : tab.removeAttribute('data-n');
  }
  function renderFeed() {
    const el = $('#feedList'); if (!el) return;
    badge();
    if (!st.user) { el.innerHTML = ''; return; }
    const posts = st.catches.filter(c => feedMode === 'all' || c.uid === st.uid).sort((a, b) => b.t - a.t).slice(0, 60);
    if (!posts.length) { el.innerHTML = `<div class="empty">${feedMode === 'mine' ? 'ยังไม่มีปลาที่แชร์ กด ＋ เพื่อบันทึกปลาตัวแรก' : 'ยังไม่มีใครโพสต์ปลา เป็นคนแรกเลย กด ＋ บันทึกปลา'}</div>`; return; }
    el.innerHTML = posts.map(c => { const name = nameOf(c.uid, c.by), av = avOf(c.uid, c.av), place = placeOf(c), nl = likesOf(c.id).length, cms = cmsOf(c.id), last = cms[cms.length - 1];
      const rd = [c.wt ? `<span><small>หนัก</small><b>${c.wt}</b><i>กก.</i></span>` : '', c.len ? `<span><small>ยาว</small><b>${c.len}</b><i>ซม.</i></span>` : '', c.bait ? `<span class="wide"><small>เหยื่อ</small><b class="t">${esc(c.bait)}</b></span>` : ''].join('');
      return `<article class="post" data-post="${c.id}">
        <header>${avatar(av, name)}<div><b>${esc(name)}</b><span class="sub">${ago(c.t)}${place ? ' · ' + esc(place) : ''}</span></div>${c.uid === st.uid || st.admin ? `<button class="pmore" data-pmore="${c.id}" aria-label="เพิ่มเติม">⋮</button>` : ''}</header>
        <div class="pframe">${c.photo ? `<img class="pimg" loading="lazy" src="${c.photo}" alt="${esc(c.species)}">` : `<div class="pimg none">🐟</div>`}<span class="ptag">${esc(c.species)}${c.released ? ' · ปล่อยคืนน้ำ' : ''}</span><i class="pburst">${SVG_HEART}</i></div>
        ${rd ? `<div class="pread">${rd}</div>` : ''}
        ${c.note ? `<p class="pnote">${esc(c.note)}</p>` : ''}
        <div class="pact"><button class="pa like${iLike(c.id) ? ' on' : ''}" data-like="${c.id}" aria-pressed="${iLike(c.id)}" aria-label="ถูกใจ">${SVG_HEART}<span>${nl || ''}</span></button><button class="pa" data-cm="${c.id}" aria-label="ความคิดเห็น">${SVG_CM}<span>${cms.length || ''}</span></button>${c.lat != null ? `<button class="pa map" data-pmap="${c.id}">${SVG_PIN}<span>ดูจุด</span></button>` : ''}</div>
        ${last ? `<button class="plast" data-cm="${c.id}"><b>${esc(nameOf(last.uid, last.by))}</b> ${esc(last.text)}${cms.length > 1 ? `<span class="sub">ดูทั้งหมด ${cms.length} ความคิดเห็น</span>` : ''}</button>` : ''}
      </article>`; }).join('');
    $$('#feedList .pframe').forEach(x => { let tm = null; x.onclick = () => { const id = x.closest('[data-post]').dataset.post;
      if (tm) { clearTimeout(tm); tm = null; if (!iLike(id)) toggleLike(id); const b = x.querySelector('.pburst'); b.classList.remove('go'); void b.offsetWidth; b.classList.add('go'); return; }
      tm = setTimeout(() => { tm = null; openPost(id); }, 280); }; });
    $$('#feedList [data-like]').forEach(b => b.onclick = () => toggleLike(b.dataset.like));
    $$('#feedList [data-cm]').forEach(b => b.onclick = () => openComments(b.dataset.cm));
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
    return `<div class="card-h" style="font-size:15px">จัดการผู้ใช้ (แอดมิน) · ${st.members.length} คน</div>${rows || '<div class="sub">ยังไม่มีผู้ใช้อื่น</div>'}<div class="sub" style="margin-top:6px">แตะหมุดหรือปลาของใครก็ได้ เพื่อลบทีละรายการ</div>`;
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
  function avSheet() {
    openSheet(`<h3>รูปโปรไฟล์</h3><div class="avpick">${avatar(myAv(), st.me, 'av big')}</div>
      <div class="row" style="flex-direction:column;align-items:stretch"><label class="btn">เลือกรูปจากเครื่อง<input type="file" id="avFile" accept="image/*" hidden></label>
      ${ls.get('myAv', '') && st.user?.photoURL ? '<button class="btn ghost" id="avG">ใช้รูปจากบัญชี Google</button>' : ''}</div><div class="sub" style="margin-top:8px">ทุกคนในชุมชนจะเห็นรูปนี้ข้างชื่อคุณ</div>`);
    $('#avFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; const url = await squareThumb(f, 256); if (!url) return toast('เปิดรูปนี้ไม่ได้'); setAv(url); };
    if ($('#avG')) $('#avG').onclick = () => setAv('');
  }
  function squareThumb(file, size) {   // ตัดกลางรูปเป็นสี่เหลี่ยมจัตุรัส ย่อเหลือ 256px
    return new Promise(res => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => { const m = Math.min(im.width, im.height), c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, size, size); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', .8)); }; im.onerror = () => res(null); im.src = u; });
  }
  async function setAv(url) {
    ls.set('myAv', url); closeSheet(); render();
    if (st.ready && !st.banned) await col('members').doc(st.uid).set({ uid: st.uid, av: myAv(), seen: Date.now() }, { merge: true }).then(() => toast('เปลี่ยนรูปโปรไฟล์แล้ว')).catch(e => toast('บันทึกรูปไม่ได้: ' + e.message));
    else toast('เปลี่ยนรูปแล้ว (จะส่งขึ้นชุมชนเมื่อเชื่อมต่อ)');
    Object.keys(pushed).forEach(k => delete pushed[k]); ls.set('grpPushed', pushed); syncAll('pins'); syncAll('catches');   // อัปเดตลิงก์รูปในโพสต์เก่า
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
    renderMap, render, pinSheet, catchSheet: catchSheetF, badge, openComments,
    get joined() { return enabled() && !!st.user; },
    friendPins, friendCatches, st
  };
})();
