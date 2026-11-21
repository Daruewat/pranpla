'use strict';
/* ============ ชุมชน: ผู้ใช้ที่เข้าสู่ระบบ (Google) เห็นหมุดและปลาที่จับได้ของกันและกัน (Firebase: Firestore + Auth) ============
   โครงข้อมูล: groups/all/members/{uid} · pins/{id} · catches/{id} · admins/{uid} (สร้างเองใน Console) · banned/{uid}
   ทุกเอกสารมี uid ของเจ้าของ กฎฐานข้อมูล (firestore.rules): แก้/ลบได้เฉพาะของตัวเอง แอดมินจัดการได้ทั้งหมด */
const GRP = (() => {
  const st = { gid: 'all', gname: 'ชุมชนพรานปลา', me: ls.get('myname', ''), uid: null, user: null, admin: false, banned: false, bannedList: [], db: null, ready: false, authed: false, err: '', pins: [], catches: [], members: [], likes: [], comments: [], votes: [], unsub: [], first: { pins: false, catches: false } };
  const layer = L.layerGroup().addTo(map);
  const pushed = ls.get('grpPushed', {});           // id → ลายนิ้วมือของข้อมูลที่ส่งขึ้นไปล่าสุด กันส่งซ้ำ
  const enabled = () => !!(window.FB_CONFIG && FB_CONFIG.apiKey);
  const col = n => st.db.collection('groups').doc(st.gid).collection(n);
  const fp = o => { const s = JSON.stringify(o); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + h; };
  const initial = n => ((n || '?').trim().replace(/^[เแโใไ]/, '') || '?').charAt(0).toUpperCase();   // ข้ามสระหน้า เช่น เพื่อน → พ
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
  async function logout() { const was = st.uid || st.user?.uid; stop(); ls.set('myAv', ''); ls.set('myname', ''); st.me = ''; await window.acctOut?.(was); await firebase.auth().signOut().catch(() => {}); st.admin = false; st.banned = false; render(); toast('ออกจากระบบแล้ว · ข้อมูลของบัญชีเก็บไว้ ล็อกอินกลับมาก็เห็นครบ', 4000); }
  async function start() {
    stop(); st.err = '';
    if (!st.user) { render(); return; }
    try {
      st.uid = st.user.uid;
      await window.acctIn?.(st.uid);   // ดึงข้อมูลของบัญชีนี้ที่เก็บไว้ในเครื่องกลับมา
      st.admin = await st.db.collection('admins').doc(st.uid).get().then(d => d.exists).catch(() => false);
      st.banned = await st.db.collection('banned').doc(st.uid).get().then(d => d.exists).catch(() => false);
      const md = await col('members').doc(st.uid).get().then(d => d.exists ? d.data() : null).catch(() => null);   // รูปที่ตั้งไว้จากเครื่องอื่น
      if (!ls.get('myAv', '') && /^data:/.test(md?.av || '')) ls.set('myAv', md.av);
      if (md?.name && md.name !== 'ไม่ระบุชื่อ' && !ls.get('myname', '')) { st.me = md.name; ls.set('myname', md.name); }   // ชื่อที่ตั้งไว้จากเครื่องอื่น
      if (!st.me) { st.me = (st.user.displayName || '').trim().slice(0, 24); if (st.me) ls.set('myname', st.me); }
      if (!st.banned) col('members').doc(st.uid).set({ uid: st.uid, name: st.me || 'ไม่ระบุชื่อ', av: myAv(), seen: Date.now() }, { merge: true }).catch(() => {});
      const watch = (name, key, after, each) => st.unsub.push(col(name).onSnapshot(snap => {
        st[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!st.first[key]) { st.first[key] = true; after && after(); }
        each && each();
        render();
      }, e => { st.err = e.code === 'permission-denied' ? 'ฐานข้อมูลปฏิเสธการเข้าถึง (ตรวจกฎความปลอดภัยใน Firebase)' : (e.message || String(e)); render(); }));
      watch('pins', 'pins', () => syncAll('pins'));
      watch('catches', 'catches', () => syncAll('catches'), hotRefresh);
      watch('members', 'members');
      watch('likes', 'likes');
      watch('votes', 'votes', null, hotRefresh);
      watch('comments', 'comments', null, () => { if (cmOpen) renderComments(); });
      if (st.admin) st.unsub.push(st.db.collection('banned').onSnapshot(s => { st.bannedList = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, () => {}));
      st.ready = true;
    } catch (e) { st.err = navigator.onLine === false ? 'ออฟไลน์ — จะเชื่อมเมื่อมีเน็ต' : (e.message || String(e)); }
    render();
  }
  function stop() { st.unsub.forEach(f => { try { f(); } catch {} }); st.unsub = []; st.ready = false; st.pins = []; st.catches = []; st.members = []; st.likes = []; st.comments = []; st.votes = []; st.first = { pins: false, catches: false }; }

  /* ---------- ส่งของเราขึ้นกลุ่ม ---------- */
  function thumb(src, max = 360) {
    if (!src) return Promise.resolve(null);
    return new Promise(res => { const im = new Image(); im.onload = () => { const s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .6)); }; im.onerror = () => res(null); im.src = src; });
  }
  const spotDoc = s => ({ uid: st.uid, by: st.me || 'ไม่ระบุชื่อ', av: docAv(), type: s.type, name: s.name, lat: s.lat, lng: s.lng, fish: s.fish || '', note: s.note || '', fee: s.fee || '', hours: s.hours || '', rules: s.rules || '', tel: s.tel || '', hab: s.hab || [], park: s.park || '', walk: s.walk || '', baits: s.baits || '' });
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
    if (!remote || remote.uid === st.uid) { if (remote) await clearReactions(id).catch(() => {}); await col(kind).doc(id).delete().catch(e => console.warn('ลบไม่สำเร็จ จะลองใหม่ตอนเปิดแอป', e)); }
    delete pushed[kind + ':' + id]; ls.set('grpPushed', pushed);
  }
  async function syncAll(kind) {      // ส่งของในเครื่องที่ยังไม่ขึ้น และดึงของเราจากเซิร์ฟเวอร์ที่เครื่องนี้ไม่มี (เช่น เปลี่ยนเครื่อง/ล้างเบราว์เซอร์)
    if (!st.ready) return;
    const local = kind === 'pins' ? S.spots : S.catches, ids = new Set(local.map(x => x.id));
    st[kind].filter(r => r.uid === st.uid && tomb[kind + ':' + r.id] && !ids.has(r.id)).forEach(r => drop(kind, r.id));   // ลบค้าง: เคยลบในเครื่องแต่บนเซิร์ฟเวอร์ยังอยู่ (ตอนลบเน็ตหลุด/ยังไม่ล็อกอิน) ลบให้ใหม่
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
  async function clearReactions(post) { for (const k of ['likes', 'comments', 'votes']) for (const x of st[k].filter(x => x.post === post)) await col(k).doc(x.id).delete().catch(() => {}); }
  async function adminDel(kind, id) { if (!st.admin) return; await clearReactions(id); await col(kind).doc(id).delete().then(() => toast('ลบแล้ว')).catch(e => toast('ลบไม่ได้: ' + e.message)); }
  async function ban(uid, name, on) {
    if (!st.admin || uid === st.uid) return;
    const ref = st.db.collection('banned').doc(uid);
    await (on ? ref.set({ uid, name: name || '', by: st.uid, t: Date.now() }) : ref.delete()).then(() => toast(on ? 'แบนแล้ว คนนี้ปักหมุดหรือแก้อะไรไม่ได้อีก' : 'ปลดแบนแล้ว')).catch(e => toast(e.message));
  }
  async function wipe(uid) { if (!st.admin) return; let n = 0; for (const k of ['pins', 'catches', 'comments', 'likes', 'votes']) for (const x of st[k].filter(x => x.uid === uid)) { if (k === 'catches' || k === 'pins') await clearReactions(x.id); await col(k).doc(x.id).delete().catch(() => {}); if (k !== 'likes') n++; } toast(`ลบแล้ว ${n} รายการ`); }
  const armBtn = (el, label, fn) => { let a = false; el.onclick = e => { if (!a) { a = true; e.currentTarget.textContent = label; return; } fn(); }; };

  function adminEditPin(p) {   // แอดมินแก้หมุดของคนอื่นบนเซิร์ฟเวอร์โดยตรง (เจ้าของยังเป็นคนเดิม)
    let type = p.type;
    const f = (k, l, ph = '') => `<label>${l}</label><input name="${k}" value="${esc(p[k] || '')}" placeholder="${ph}">`;
    openSheet(`<h3>แก้ไขหมุดของ ${esc(p.by)}</h3><div class="sub">แก้ในฐานะแอดมิน เจ้าของหมุดยังเป็น ${esc(p.by)}</div><div class="form">
      <label>ประเภท</label><div class="types">${Object.entries(SPOT_TYPES).filter(([, t]) => !t.hidden).map(([k, t]) => `<button type="button" data-type="${k}" class="${k === type ? 'sel' : ''}">${t.icon} ${t.label}</button>`).join('')}</div>
      ${f('name', 'ชื่อจุด')}${f('fish', 'ปลาที่เจอ')}<label>โน้ต</label><textarea name="note">${esc(p.note || '')}</textarea>
      <div class="two"><div>${f('fee', 'ค่าบริการ / ค่าบ่อ')}</div><div>${f('hours', 'เวลาเปิด–ปิด')}</div></div>${f('rules', 'กฎ / ข้อห้าม')}${f('tel', 'เบอร์ติดต่อ')}
      <div class="row"><button class="btn block acc" id="aeSave">บันทึก</button></div></div>`);
    const r = $('#sheet');
    $$('.types button', r).forEach(b => b.onclick = () => { type = b.dataset.type; $$('.types button', r).forEach(x => x.classList.toggle('sel', x === b)); });
    $('#aeSave').onclick = async () => {
      const d = { type, updated: Date.now() }; ['name', 'fish', 'note', 'fee', 'hours', 'rules', 'tel'].forEach(k => d[k] = $(`[name=${k}]`, r).value.trim());
      if (!d.name) d.name = (SPOT_TYPES[type] || SPOT_TYPES.other).label;
      await col('pins').doc(p.id).set(d, { merge: true }).then(() => { toast('แก้หมุดแล้ว'); closeSheet(); }).catch(e => toast('แก้ไม่ได้: ' + e.message));
    };
  }

  /* ---------- ของเพื่อน ---------- */
  const friendPins = () => st.user ? st.pins.filter(p => p.uid !== st.uid) : [];
  const friendCatches = () => (st.user ? st.catches : []).filter(c => c.uid !== st.uid).sort((a, b) => b.t - a.t);
  let hotT = null;
  function hotRefresh() { clearTimeout(hotT); hotT = setTimeout(() => { try { renderSpots(); } catch {} const hp = $('#hotPanel'); if (hp && hotOpen) window.HOT?.refreshPanel(hotOpen); }, 150); }
  let hotOpen = null;
  async function vote(pin, v) {   // 1 = ยังกินอยู่, -1 = เงียบแล้ว, 0 = ยกเลิก
    if (!st.ready || !st.user) return 'login';
    if (st.banned) { toast('บัญชีนี้ถูกระงับ'); return 'banned'; }
    if (!st.pins.some(p => p.id === pin)) return 'private';
    const id = pin + '_' + st.uid, ref = col('votes').doc(id);
    st.votes = st.votes.filter(x => x.id !== id);
    if (v) st.votes.push({ id, uid: st.uid, post: pin, v, t: Date.now() });
    if (v) await ref.set({ uid: st.uid, post: pin, v, t: Date.now() }).catch(e => toast(e.message)); else await ref.delete().catch(() => {});
    hotRefresh(); return 'ok';
  }
  function renderMap() {
    layer.clearLayers();
    if (OPT.friends === false) return;
    friendPins().filter(p => inRange(p) && (!OPT.types || OPT.types.includes(p.type === 'hot' ? 'fish' : p.type))).forEach(p => {
      const t = SPOT_TYPES[p.type] || SPOT_TYPES.other;
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="mk friend${window.HOT ? HOT.markClass(p) : ''}" style="background:${t.color}"><span>${t.icon}</span><em>${esc(initial(p.by))}</em></div>`, iconSize: [34, 34], iconAnchor: [17, 34] }) }).on('click', () => pinSheet(p.id)).addTo(layer);
    });
  }
  function pinSheet(id) {
    const p = st.pins.find(x => x.id === id); if (!p) return;
    const t = SPOT_TYPES[p.type] || SPOT_TYPES.other, n = st.catches.filter(c => c.lat != null && dist(c, p) < 150).length;
    openSheet(`<h3>${t.icon} ${esc(p.name)}</h3>
    <div class="sub">👥 หมุดของ ${esc(p.by)} · ${t.label}${S.pos ? ' · ห่าง ' + fmtDist(dist(S.pos, p)) : ''}</div>
    ${window.HOT ? HOT.panel(p) : ''}
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
      ${st.admin ? '<button class="btn ghost" id="fpEdit">แก้ไขหมุด (แอดมิน)</button><button class="btn danger" id="fpDel">ลบหมุดนี้ (แอดมิน)</button>' : ''}
    </div>`);
    if (st.admin) { armBtn($('#fpDel'), 'แตะอีกครั้งเพื่อลบหมุดของ ' + p.by, () => { adminDel('pins', p.id); closeSheet(); }); $('#fpEdit').onclick = () => adminEditPin(p); }
    hotOpen = p; window.HOT?.bindPanel(p, () => window.HOT.refreshPanel(p));
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
    <div class="row"><button class="btn ghost" id="fcCm">ความคิดเห็น ${st.comments.filter(x => x.post === c.id).length || ''}</button>${c.lat != null ? `<button class="btn acc" id="fcMap">🗺️ ดูบนแผนที่</button><button class="btn ghost" id="fcNav">🧭 นำทางไปจุดนี้</button>` : ''}${c.uid === st.uid ? '<button class="btn danger" id="fcDel">ลบโพสต์นี้</button>' : st.admin ? '<button class="btn danger" id="fcDel">ลบ (แอดมิน)</button>' : ''}</div>`);
    $('#fcCm').onclick = () => openComments(c.id);
    if (c.uid === st.uid) armBtn($('#fcDel'), 'แตะอีกครั้งเพื่อลบ', () => { S.catches = S.catches.filter(x => x.id !== c.id); save('catches'); renderLog(); drop('catches', c.id).then(() => toast('ลบแล้ว')); closeSheet(); });
    else if (st.admin) armBtn($('#fcDel'), 'แตะอีกครั้งเพื่อลบ', () => { adminDel('catches', c.id); closeSheet(); });
    if (c.lat != null) {
      $('#fcMap').onclick = () => { closeSheet(); showTab('map'); S.follow = false; map.setView([c.lat, c.lng], 15); };
      $('#fcNav').onclick = () => { setTarget({ lat: c.lat, lng: c.lng, name: c.species + ' ของ ' + c.by }); closeSheet(); showTab('tools'); };
    }
  }

  /* ---------- หน้ากลุ่มในแท็บบันทึก ---------- */
  const GLOGO = '<svg class="gg" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.5-9.4 6.5-16.1z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.4v5.7C8 41 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.7 28.1c-.4-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.4C2.9 17.2 2 20.5 2 24s.9 6.8 2.4 9.8l7.3-5.7z"/><path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8 7 4.4 14.2l7.3 5.7c1.7-5.2 6.6-9.1 12.3-9.1z"/></svg>';
  const loginHero = (id, title, sub) => `<div class="lhero"><div class="lrings"><i></i><i></i><i></i></div><img class="llogo" src="icons/icon-192.png?v=3" alt="">
    <h2>${title}</h2><div class="sub">${sub}</div>
    <div class="lben"><div><b>☁️</b>หมุดและปลาสำรองบนคลาวด์ ไม่หาย</div><div><b>🔥</b>เห็นหมายเด็ดที่เพื่อนแชร์</div><div><b class="lh"><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg></b>ไลก์ คอมเมนต์ ปลาของเพื่อน</div></div>
    ${st.err ? `<div class="warn" style="margin:0 0 12px;text-align:left">${esc(st.err)}</div>` : ''}
    <button class="gbtn" id="${id}" ${st.authed ? '' : 'disabled'}>${GLOGO}เข้าสู่ระบบด้วย Google</button>
    <small>เราเห็นแค่ชื่อกับรูปโปรไฟล์ ไม่โพสต์อะไรแทนคุณ</small></div>`;
  const avatar = (url, name, cls = 'av') => url ? `<i class="${cls}" style="background-image:url('${esc(url)}')"></i>` : `<i class="${cls}">${esc(initial(name))}</i>`;
  const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 60 ? Math.max(1, m) + ' นาทีที่แล้ว' : m < 1440 ? Math.round(m / 60) + ' ชม.ที่แล้ว' : m < 10080 ? Math.round(m / 1440) + ' วันที่แล้ว' : new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); };
  let tambons = null; loadTambons().then(T => { tambons = T; renderFeed(); });
  const placeOf = c => { if (c.spot) return c.spot; if (!tambons || c.lat == null) return ''; let b = null, bd = 1e12; for (const t of tambons) { if (Math.abs(t[0] - c.lat) > .2 || Math.abs(t[1] - c.lng) > .2) continue; const d = dist(c, { lat: t[0], lng: t[1] }); if (d < bd) { bd = d; b = t; } } return b ? `${b[2]} · ${b[3]}` : ''; };
  let feedMode = 'all';
  function render() { renderMap(); renderProfile(); renderCommunity(); renderFeed(); }
  function renderProfile() {   // หน้า "ของฉัน" แบบโปรไฟล์ไอจี
    const el = $('#profileBox'), av = $('#meAv'), ttl = $('#meTitle'); if (!el) return; el.classList.remove('login-mode');
    if (ttl) ttl.textContent = st.user && st.me ? st.me : 'ของฉัน';
    if (!enabled() || !st.user) {
      if (av) av.innerHTML = ringAv('', 'ฉัน', 'big seen');
      if (!enabled()) { el.innerHTML = '<div class="mebio"><b>ของฉัน</b><div class="sub">เก็บไว้ในเครื่องนี้</div></div>'; return; }
      el.classList.add('login-mode'); el.innerHTML = loginHero('pLogin', 'เข้าร่วมก๊วนพรานปลา', 'ล็อกอินครั้งเดียว ใช้ได้ทุกเครื่อง');
      $('#pLogin').onclick = () => { st.err = ''; login(); };
      return;
    }
    if (av) { av.innerHTML = `<button class="avedit" id="pAv" aria-label="เปลี่ยนรูปโปรไฟล์">${ringAv(myAv(), st.me, 'big')}</button>`; $('#pAv').onclick = avSheet; }
    el.innerHTML = `<div class="mebio"><b>${esc(st.me || 'ไม่ระบุชื่อ')}</b>${teamB(st.uid)}${st.admin ? ' <span class="adm">แอดมิน</span>' : ''}<div class="sub">นักล่าปลาช่อนข้างทาง · พรานปลา</div></div>
      <div class="mebtns"><button class="btn ghost" id="pEdit">แก้ไขโปรไฟล์</button><button class="btn ghost" id="pShare">แชร์โปรไฟล์</button></div>`;
    $('#pEdit').onclick = editSheet; $('#pShare').onclick = shareProfile;
  }
  function editSheet() {
    openSheet(`<h3>แก้ไขโปรไฟล์</h3><div class="menu">
      <button class="menu-item" id="pAv2"><span class="mi">🖼️</span><span><b>เปลี่ยนรูปโปรไฟล์</b></span></button>
      <button class="menu-item" id="pName"><span class="mi">✏️</span><span><b>เปลี่ยนชื่อ</b><small>${esc(st.me || '')}</small></span></button>
      ${st.admin ? '' : '<button class="menu-item" id="pUid"><span class="mi">🔑</span><span><b>คัดลอกรหัสผู้ใช้</b></span></button>'}
      <button class="menu-item danger" id="pOut"><span class="mi">↩️</span><span><b>ออกจากระบบ</b><small>ข้อมูลบัญชีเก็บไว้ ล็อกอินกลับมาก็เห็นครบ</small></span></button></div>`);
    $('#pAv2').onclick = avSheet; $('#pName').onclick = renameSheet; $('#pOut').onclick = () => { closeSheet(); logout(); };
    if ($('#pUid')) $('#pUid').onclick = () => copy(st.uid, 'คัดลอกรหัสผู้ใช้แล้ว');
  }
  async function shareProfile() {
    const n = S.catches.filter(c => !c.private).length, sp = new Set(S.catches.map(c => c.species)).size, big = S.catches.reduce((m, c) => Math.max(m, +c.wt || 0), 0);
    const text = `${st.me || 'ผม'} ในพรานปลา: จับไป ${n} ตัว ${sp} ชนิด${big ? ` ตัวใหญ่สุด ${big} กก.` : ''} 🎣 มาลงหมายด้วยกัน`, url = location.origin + location.pathname;
    try { if (navigator.share) return await navigator.share({ title: 'พรานปลา', text, url }); } catch (e) { if (e && e.name === 'AbortError') return; }
    copy(text + '\n' + url, 'คัดลอกข้อความแชร์แล้ว');
  }
  function renderCommunity() {
    const el = $('#groupCard'); if (!el) return; el.classList.remove('login-mode');
    $('#feedSeg')?.classList.toggle('hidden', !st.user);
    if (!enabled()) { el.innerHTML = '<div class="sub">ยังไม่ได้เชื่อมเซิร์ฟเวอร์</div>'; return; }
    if (!st.user) {
      el.classList.add('login-mode'); el.innerHTML = loginHero('gLogin', 'ดูปลาและหมายเด็ดของทุกคน', 'เข้าสู่ระบบเพื่อเห็นโพสต์ของก๊วน และแชร์ปลาของคุณ');
      $('#gLogin').onclick = () => { st.err = ''; login(); };
      return;
    }
    const note = [st.banned ? 'บัญชีนี้ถูกระงับการแชร์ หมุดและปลาของคุณจะไม่ถูกส่งขึ้นไป' : '', st.err, !st.ready && !st.err ? 'กำลังเชื่อม…' : navigator.onLine === false ? 'ออฟไลน์ · จะซิงก์เมื่อมีเน็ต' : ''].filter(Boolean);
    el.classList.toggle('hidden', !note.length);
    el.innerHTML = note.map(n => `<div class="warn" style="margin:0 0 8px">${esc(n)}</div>`).join('');
    if ($('#sheet.open #admBox')) peopleSheet();   // แผงแอดมินเปิดอยู่: อัปเดตตามข้อมูลใหม่
  }
  const SVG_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3S3.5 15 3.5 9.1A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.5 2.5C20.5 15 12 20.3 12 20.3Z"/></svg>';
  const SVG_CM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4Z"/></svg>';
  const SVG_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7h16v-7M12 3v12M7 8l5-5 5 5"/></svg>';
  const SVG_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  const likesOf = id => st.likes.filter(l => l.post === id);
  const cmsOf = id => st.comments.filter(c => c.post === id).sort((a, b) => a.t - b.t);
  const iLike = id => st.likes.some(l => l.post === id && l.uid === st.uid);
  const isTeam = uid => typeof TEAM_UIDS !== 'undefined' && TEAM_UIDS.includes(uid);
  const teamB = uid => isTeam(uid) ? '<span class="teamb" title="บัญชีทางการ">✓ ทีมพรานปลา</span>' : '';
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
      return `<div class="cm">${avatar(avOf(m.uid, m.av), nameOf(m.uid, m.by))}<div class="cmb"><div><b>${esc(nameOf(m.uid, m.by))}</b>${teamB(m.uid)} <span class="sub">${ago(m.t)}</span></div><p>${esc(m.text)}</p></div>${can ? `<button class="cmdel" data-cmdel="${m.id}" aria-label="ลบความคิดเห็น">ลบ</button>` : ''}</div>`; }).join('')
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
  /* ---------- การแจ้งเตือน: มีคนถูกใจ/คอมเมนต์ปลาของเรา หรือโหวตหมายของเราว่ายังกินอยู่ ---------- */
  function notis() {
    const mc = new Map(st.catches.filter(c => c.uid === st.uid).map(c => [c.id, c])), mp = new Map(st.pins.filter(p => p.uid === st.uid).map(p => [p.id, p]));
    const nm = uid => st.members.find(m => m.uid === uid)?.name || 'มีคน', out = [];
    st.likes.forEach(l => { if (l.uid !== st.uid && mc.has(l.post)) out.push({ k: 'like', t: l.t || 0, uid: l.uid, who: nm(l.uid), post: l.post, txt: `ถูกใจ${mc.get(l.post).species || 'ปลา'}ของคุณ` }); });
    st.comments.forEach(c => { if (c.uid !== st.uid && mc.has(c.post)) out.push({ k: 'cm', t: c.t || 0, uid: c.uid, who: c.by || nm(c.uid), post: c.post, txt: `คอมเมนต์${mc.get(c.post).species || 'ปลา'}ของคุณ: “${(c.text || '').slice(0, 80)}”` }); });
    st.votes.forEach(v => { if (v.uid !== st.uid && mp.has(v.post) && v.v > 0) out.push({ k: 'vote', t: v.t || 0, uid: v.uid, who: nm(v.uid), pin: v.post, txt: `บอกว่าหมาย “${mp.get(v.post).name}” ของคุณยังกินอยู่` }); });
    return out.sort((a, b) => b.t - a.t).slice(0, 60);
  }
  function badge() {
    const all = notis(), nSeen = ls.get('notiSeen', ls.get('feedSeen', 0));
    if ($('#view-feed')?.classList.contains('show')) ls.set('feedSeen', Date.now());   // เปิดหน้าชุมชนแล้ว ป้ายบนแท็บหาย (กระดิ่งยังนับจนกว่าจะเปิดดู)
    const tSeen = Math.max(nSeen, ls.get('feedSeen', 0)), set = (el, n) => { if (el) n ? el.setAttribute('data-n', n > 9 ? '9+' : n) : el.removeAttribute('data-n'); };
    set(document.querySelector('.tabbar [data-tab=feed]'), all.filter(x => x.t > tSeen).length);
    set($('#feedBell'), all.filter(x => x.t > nSeen).length);
    sysNotify(all);
  }
  function sysNotify(all) {   // แจ้งเตือนบนเครื่อง ตอนแอปเปิดค้างไว้แต่อยู่เบื้องหลัง
    let last = ls.get('notiPushed', 0); if (!last) { ls.set('notiPushed', Date.now()); return; }
    const fresh = all.filter(x => x.t > last); if (!fresh.length) return;
    ls.set('notiPushed', Math.max(...fresh.map(x => x.t)));
    if (!document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !navigator.serviceWorker) return;
    const x = fresh[0], more = fresh.length > 1 ? ` และอีก ${fresh.length - 1} รายการ` : '';
    navigator.serviceWorker.ready.then(r => r.showNotification('พรานปลา', { body: `${x.who} ${x.txt}${more}`, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'pranpla-noti', renotify: true, data: { url: './#noti' } })).catch(() => {});
  }
  function notiSheet() {
    const seen = ls.get('notiSeen', ls.get('feedSeen', 0)), all = notis();
    ls.set('notiSeen', Date.now()); badge();
    const canAsk = typeof Notification !== 'undefined' && Notification.permission === 'default';
    openSheet(`<h3>การแจ้งเตือน</h3>
      ${!st.user ? '<div class="empty">เข้าสู่ระบบก่อน จะรู้ได้ว่ามีใครถูกใจหรือคอมเมนต์ปลาของคุณ</div>' : all.length ? `<div class="notis">${all.map((x, i) => `<button class="noti${x.t > seen ? ' new' : ''}" data-ni="${i}">${avatar(avOf(x.uid, ''), x.who)}<span class="nt"><b>${esc(x.who)}</b> ${esc(x.txt)}<small>${ago(x.t)}</small></span><span class="nk nk-${x.k}">${x.k === 'like' ? SVG_HEART : x.k === 'cm' ? SVG_CM : '🔥'}</span></button>`).join('')}</div>` : '<div class="empty">ยังไม่มีการแจ้งเตือน พอมีคนถูกใจ คอมเมนต์ปลาของคุณ หรือโหวตหมายของคุณ จะขึ้นที่นี่</div>'}
      ${canAsk ? '<button class="btn ghost block" id="notiAsk" style="margin-top:12px">🔔 แจ้งเตือนบนมือถือด้วย</button><div class="sub" style="margin-top:6px">แจ้งตอนแอปยังเปิดค้างอยู่เบื้องหลัง</div>' : ''}`);
    $$('#sheet [data-ni]').forEach(b => b.onclick = () => {
      const x = all[+b.dataset.ni]; closeSheet();
      if (x.k === 'cm') setTimeout(() => openComments(x.post), 350);
      else if (x.k === 'like') setTimeout(() => openPost(x.post), 350);
      else { const p = st.pins.find(q => q.id === x.pin); if (p) { showTab('map'); S.follow = false; map.setView([p.lat, p.lng], 16); if (S.spots.some(s => s.id === p.id)) setTimeout(() => spotSheet(p.id), 350); } }
    });
    const a = $('#notiAsk'); if (a) a.onclick = () => Notification.requestPermission().then(r => { toast(r === 'granted' ? 'เปิดแจ้งเตือนแล้ว' : 'ไม่ได้เปิดแจ้งเตือน (เปิดได้ในตั้งค่าเบราว์เซอร์)'); if (r === 'granted') a.remove(); });
  }
  $('#feedBell')?.addEventListener('click', () => notiSheet());
  if (location.hash === '#noti') { history.replaceState(null, '', location.pathname + location.search); setTimeout(() => { showTab('feed'); notiSheet(); }, 1500); }
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.openNoti) { showTab('feed'); notiSheet(); } });
  const ringAv = (url, name, cls = '') => `<span class="ring ${cls}">${avatar(url, name)}</span>`;
  function renderStories() {   // แถววงกลมด้านบน: คนที่โพสต์ปลาล่าสุด วงสีคือยังไม่ได้ดู
    const box = $('#feedStories'); if (!box) return;
    if (!st.user) { box.classList.add('hidden'); return; }
    const seen = ls.get('storySeen', {}), latest = new Map();
    st.catches.slice().sort((a, b) => b.t - a.t).forEach(c => { if (!latest.has(c.uid)) latest.set(c.uid, c); });
    const list = [...latest.values()].filter(c => Date.now() - c.t < 30 * 864e5).slice(0, 15)
      .map(c => ({ c, fresh: Date.now() - c.t < 3 * 864e5 && (seen[c.uid] || 0) < c.t })).sort((a, b) => b.fresh - a.fresh || b.c.t - a.c.t);
    box.classList.remove('hidden');
    box.innerHTML = `<button class="story" id="stAdd"><span class="ring add"><i class="av">＋</i></span><span>บันทึกปลา</span></button>` +
      list.map(({ c, fresh }) => `<button class="story" data-story="${c.id}" data-u="${c.uid}">${ringAv(avOf(c.uid, c.av), nameOf(c.uid, c.by), fresh ? '' : 'seen')}<span>${esc(c.uid === st.uid ? 'ของฉัน' : nameOf(c.uid, c.by))}</span></button>`).join('');
    $('#stAdd').onclick = () => window.catchForm && catchForm({});
    $$('#feedStories [data-story]').forEach(b => b.onclick = () => {
      const sn = ls.get('storySeen', {}); sn[b.dataset.u] = Date.now(); ls.set('storySeen', sn);
      if (feedMode !== 'all') { feedMode = 'all'; $$('#feedSeg button').forEach(x => x.classList.toggle('sel', x.dataset.feed === 'all')); }
      renderFeed();
      const el = document.querySelector(`#feedList [data-post="${b.dataset.story}"]`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
    });
  }
  function sharePost(c) {
    const link = `${location.origin}${location.pathname}`, text = `${nameOf(c.uid, c.by)} ได้${c.species}${c.wt ? ' ' + c.wt + ' กก.' : ''}${c.len ? ' ' + c.len + ' ซม.' : ''}${c.bait ? ' เหยื่อ' + c.bait : ''} 🎣\nดูในพรานปลา ${link}`;
    if (navigator.share) navigator.share({ text }).catch(() => {}); else copy(text, 'คัดลอกแล้ว ส่งทาง LINE ได้เลย');
  }
  function renderFeed() {
    const el = $('#feedList'); if (!el) return;
    badge(); renderStories();
    if (!st.user) { el.innerHTML = ''; return; }
    el.classList.toggle('mine', feedMode === 'mine');
    if (feedMode === 'mine') return renderMine(el);
    if (feedMode === 'rank') return renderRank(el);
    const posts = st.catches.slice().sort((a, b) => b.t - a.t).slice(0, 60);
    if (!posts.length) { el.innerHTML = `<div class="empty">ยังไม่มีใครโพสต์ปลา เป็นคนแรกเลย กด ＋ บันทึกปลา แล้วเปิดแชร์ไว้</div>`; return; }
    el.innerHTML = posts.map(c => { const name = nameOf(c.uid, c.by), av = avOf(c.uid, c.av), place = placeOf(c), nl = likesOf(c.id).length, cms = cmsOf(c.id), last = cms[cms.length - 1];
      const tag = [`<b>${esc(c.species)}</b>`, c.wt ? `<em>${c.wt} กก.</em>` : '', c.len ? `${c.len} ซม.` : '', c.released ? 'ปล่อยคืน' : ''].filter(Boolean).join(' ');
      return `<article class="post ig" data-post="${c.id}">
        <header>${ringAv(av, name)}<div><b>${esc(name)}${teamB(c.uid)}</b><span class="sub">${place ? esc(place) + ' · ' : ''}${ago(c.t)}</span></div>${c.uid === st.uid || st.admin ? `<button class="pmore" data-pmore="${c.id}" aria-label="เพิ่มเติม">⋯</button>` : ''}</header>
        <div class="pframe">${c.photo ? `<img class="pimg" loading="lazy" src="${c.photo}" alt="${esc(c.species)}">` : `<div class="pimg none">🐟</div>`}<span class="ptag">${tag}</span><i class="pburst">${SVG_HEART}</i></div>
        <div class="pact"><button class="pa like${iLike(c.id) ? ' on' : ''}" data-like="${c.id}" aria-pressed="${iLike(c.id)}" aria-label="ถูกใจ">${SVG_HEART}</button><button class="pa" data-cm="${c.id}" aria-label="ความคิดเห็น">${SVG_CM}</button><button class="pa" data-share="${c.id}" aria-label="แชร์">${SVG_SHARE}</button>${c.lat != null ? `<button class="pa map" data-pmap="${c.id}">${SVG_PIN}<span>ดูหมาย</span></button>` : ''}</div>
        ${nl ? `<div class="pcap"><b>ถูกใจ ${nl} คน</b></div>` : ''}
        ${c.note || c.bait ? `<div class="pcap"><b>${esc(name)}</b> ${esc(c.note || '')}${c.bait ? ` <span class="tagw">#เหยื่อ${esc(c.bait.replace(/\s+/g, ''))}</span>` : ''}</div>` : ''}
        ${cms.length > 1 ? `<button class="pcap more" data-cm="${c.id}">ดูความคิดเห็นทั้ง ${cms.length} รายการ</button>` : ''}
        ${last ? `<button class="pcap plast" data-cm="${c.id}"><b>${esc(nameOf(last.uid, last.by))}</b> ${esc(last.text)}</button>` : ''}
      </article>`; }).join('');
    $$('#feedList .pframe').forEach(x => { let tm = null; x.onclick = () => { const id = x.closest('[data-post]').dataset.post;
      if (tm) { clearTimeout(tm); tm = null; if (!iLike(id)) toggleLike(id); const b = x.querySelector('.pburst'); b.classList.remove('go'); void b.offsetWidth; b.classList.add('go'); return; }
      tm = setTimeout(() => { tm = null; openPost(id); }, 280); }; });
    $$('#feedList [data-like]').forEach(b => b.onclick = () => toggleLike(b.dataset.like));
    $$('#feedList [data-cm]').forEach(b => b.onclick = () => openComments(b.dataset.cm));
    $$('#feedList [data-share]').forEach(b => b.onclick = () => { const c = st.catches.find(x => x.id === b.dataset.share); if (c) sharePost(c); });
    $$('#feedList [data-pmap]').forEach(b => b.onclick = () => { const c = st.catches.find(x => x.id === b.dataset.pmap); if (!c) return; showTab('map'); S.follow = false; map.setView([c.lat, c.lng], 15); });
    $$('#feedList [data-pmore]').forEach(b => b.onclick = () => openPost(b.dataset.pmore));
  }
  let rankMonth = 0, rankSp = '';
  function renderRank(el) {   // ตัวใหญ่สุดประจำเดือน: นับเฉพาะโพสต์ที่มีรูป + น้ำหนัก คนละ 1 ตัว (ตัวใหญ่สุด)
    const d = new Date(), m0 = new Date(d.getFullYear(), d.getMonth() - rankMonth, 1).getTime(), m1 = new Date(d.getFullYear(), d.getMonth() - rankMonth + 1, 1).getTime();
    const mon = new Date(m0).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
    const pool = st.catches.filter(c => c.t >= m0 && c.t < m1 && c.photo && +c.wt > 0);
    const sps = [...new Set(pool.map(c => c.species))].slice(0, 8);
    const best = new Map();
    pool.filter(c => !rankSp || c.species === rankSp).forEach(c => { const b = best.get(c.uid); if (!b || +c.wt > +b.wt || (+c.wt === +b.wt && (+c.len || 0) > (+b.len || 0))) best.set(c.uid, c); });
    const list = [...best.values()].sort((a, b) => b.wt - a.wt || (b.len || 0) - (a.len || 0) || a.t - b.t).slice(0, 20);
    const medal = i => ['🥇', '🥈', '🥉'][i] || `<span class="rk">${i + 1}</span>`;
    el.innerHTML = `<div class="rankhd"><button class="rkm${rankMonth === 0 ? ' sel' : ''}" data-rm="0">เดือนนี้</button><button class="rkm${rankMonth === 1 ? ' sel' : ''}" data-rm="1">เดือนที่แล้ว</button></div>
      <h3 class="rank-t">ตัวใหญ่สุด · ${mon}</h3>
      ${sps.length > 1 ? `<div class="kmchips rksp"><button data-rs="" class="${rankSp ? '' : 'sel'}">ทุกชนิด</button>${sps.map(x => `<button data-rs="${esc(x)}" class="${rankSp === x ? 'sel' : ''}">${esc(x)}</button>`).join('')}</div>` : ''}
      ${list.length ? `<div class="ranks">${list.map((c, i) => `<button class="rkrow${i < 3 ? ' top' : ''}" data-rp="${c.id}"><span class="rmed">${medal(i)}</span>${ringAv(avOf(c.uid, c.av), nameOf(c.uid, c.by))}<span class="rinfo"><b>${esc(nameOf(c.uid, c.by))}${teamB(c.uid)}</b><small>${esc(c.species)}${c.len ? ' · ' + c.len + ' ซม.' : ''} · ${new Date(c.t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</small></span><span class="rwt">${c.wt}<i>กก.</i></span>${c.photo ? `<span class="rph" style="background-image:url('${esc(c.photo)}')"></span>` : ''}</button>`).join('')}</div>`
        : `<div class="empty">ยังไม่มีใครลงปลา${rankSp ? esc(rankSp) : ''}ใน${rankMonth ? 'เดือนที่แล้ว' : 'เดือนนี้'} ลงปลาพร้อมรูปและน้ำหนัก ขึ้นอันดับ 1 ได้เลย</div>`}
      <div class="sub" style="margin:12px 2px">นับคนละ 1 ตัวที่ใหญ่สุด เฉพาะโพสต์ที่มีรูปและน้ำหนัก แตะเพื่อดูรูปเต็ม</div>`;
    $$('#feedList [data-rm]').forEach(b => b.onclick = () => { rankMonth = +b.dataset.rm; rankSp = ''; renderFeed(); });
    $$('#feedList [data-rs]').forEach(b => b.onclick = () => { rankSp = b.dataset.rs; renderFeed(); });
    $$('#feedList [data-rp]').forEach(b => b.onclick = () => openPost(b.dataset.rp));
  }
  function renderMine(el) {   // แท็บ "ของฉัน": หน้าโปรไฟล์ + ตารางรูป 3 ช่อง
    const mine = st.catches.filter(c => c.uid === st.uid).sort((a, b) => b.t - a.t);
    const big = mine.reduce((m, c) => Math.max(m, +c.wt || 0), 0), likes = st.likes.filter(l => mine.some(c => c.id === l.post)).length;
    el.innerHTML = `<div class="igprof">${ringAv(myAv(), st.me, 'big')}<div><b>${esc(st.me || 'ฉัน')}</b><div class="igstat"><div><b>${mine.length}</b><span>โพสต์</span></div><div><b>${new Set(mine.map(c => c.species)).size}</b><span>ชนิดปลา</span></div><div><b>${big || '-'}</b><span>กก. ใหญ่สุด</span></div><div><b>${likes}</b><span>ถูกใจ</span></div></div></div></div>` +
      (mine.length ? `<div class="iggrid">${mine.map(c => `<button data-g="${c.id}" ${c.photo ? `style="background-image:url('${esc(c.photo)}')"` : ''}>${c.photo ? '' : '<i class="gfish"><svg viewBox="0 0 24 24"><path d="M3 12c3-4.5 8-6 12-3.5L20 6v12l-5-2.5C11 18 6 16.5 3 12Z"/><circle cx="8" cy="11.5" r="1"/></svg></i>'}<span>${esc(c.species)}${c.wt ? ' ' + c.wt : ''}</span></button>`).join('')}</div>`
        : '<div class="empty">ยังไม่มีปลาที่แชร์ กด ＋ เพื่อบันทึกปลาตัวแรก</div>');
    $$('#feedList [data-g]').forEach(b => b.onclick = () => openPost(b.dataset.g));
  }
  function openPost(id) {
    const c = st.catches.find(x => x.id === id); if (!c) return;
    if (c.uid === st.uid && S.catches.some(x => x.id === id)) return catchSheet(id);
    catchSheetF(id);
  }
  $$('#feedSeg [data-feed]').forEach(b => b.onclick = () => { feedMode = b.dataset.feed; $$('#feedSeg button').forEach(x => x.classList.toggle('sel', x === b)); renderFeed(); });
  function peopleSheet() {   // ปุ่ม 👥: ชวนเพื่อน (+ แผงจัดการผู้ใช้สำหรับแอดมิน)
    if (!st.admin) return invite();
    const keep = $('#sheet.open #admBox') ? $('#sheet').scrollTop : 0;
    openSheet(`<h3>ผู้ใช้</h3><button class="btn acc block" id="pplInv">ชวนเพื่อนมาใช้พรานปลา</button><div id="admBox" style="margin-top:16px">${adminHtml()}</div>
      ${isTeam(st.uid) ? '' : `<div class="card" style="margin-top:14px"><b>เปิดป้าย "ทีมพรานปลา" ให้บัญชีนี้</b><div class="sub" style="margin:4px 0 10px">คัดลอกรหัสนี้ส่งให้ Claude</div><code class="uidc">${esc(st.uid)}</code><button class="btn small ghost" id="cpUid" style="margin-top:8px">คัดลอกรหัส</button></div>`}`);
    if ($('#cpUid')) $('#cpUid').onclick = () => copy(st.uid, 'คัดลอกแล้ว');
    $('#sheet').scrollTop = keep;
    $('#pplInv').onclick = () => invite();
    $$('#admBox [data-ban]').forEach(b => b.onclick = () => { const m = st.members.find(x => x.uid === b.dataset.ban) || st.bannedList.find(x => x.id === b.dataset.ban); ban(b.dataset.ban, m?.name, b.dataset.on === '1'); });
    $$('#admBox [data-wipe]').forEach(b => armBtn(b, 'แตะอีกครั้ง: ลบทั้งหมดของคนนี้', () => wipe(b.dataset.wipe)));
  }
  $('#feedInv')?.addEventListener('click', () => peopleSheet());
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
      <div class="row" style="flex-direction:column;align-items:stretch"><label class="btn">เลือกรูปจากเครื่อง<input type="file" id="avFile" accept="image/*,.heic,.heif" hidden></label>
      ${ls.get('myAv', '') && st.user?.photoURL ? '<button class="btn ghost" id="avG">ใช้รูปจากบัญชี Google</button>' : ''}</div><div class="sub" style="margin-top:8px">ทุกคนในชุมชนจะเห็นรูปนี้ข้างชื่อคุณ</div>`);
    $('#avFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; const url = await squareThumb(f, 256); if (!url) return toast('เปิดรูปนี้ไม่ได้'); setAv(url); };
    if ($('#avG')) $('#avG').onclick = () => setAv('');
  }
  async function squareThumb(file, size) {   // ตัดกลางรูปเป็นสี่เหลี่ยมจัตุรัส ย่อเหลือ 256px (รองรับรูป HEIF)
    try { const im = await window.decodeImage(file), m = Math.min(im.width, im.height), c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, size, size); return c.toDataURL('image/jpeg', .8); } catch { return null; }
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
    renderMap, render, pinSheet, catchSheet: catchSheetF, badge, openComments, vote, setHotOpen: s => { hotOpen = s; },
    get joined() { return enabled() && !!st.user; },
    friendPins, friendCatches, st
  };
})();
