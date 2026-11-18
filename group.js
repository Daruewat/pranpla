'use strict';
/* ============ กลุ่มเพื่อน: แชร์หมุดและปลาที่จับได้ผ่าน Firebase (Firestore + Anonymous Auth) ============
   โครงข้อมูล: groups/{gid}/meta/info · members/{uid} · pins/{id} · catches/{id}
   ทุกเอกสารมี uid ของเจ้าของ กฎฐานข้อมูล (firestore.rules) ให้แก้/ลบได้เฉพาะของตัวเอง
   รหัสกลุ่มยาวสุ่ม ใครมีรหัสหรือลิงก์ชวนจึงจะเข้าถึงกลุ่มได้ */
const GRP = (() => {
  const saved = ls.get('group', null);
  const st = { gid: saved?.id || null, gname: saved?.name || '', me: ls.get('myname', ''), uid: null, db: null, ready: false, err: '', pins: [], catches: [], members: [], unsub: [], first: { pins: false, catches: false } };
  const layer = L.layerGroup().addTo(map);
  const pushed = ls.get('grpPushed', {});           // id → ลายนิ้วมือของข้อมูลที่ส่งขึ้นไปล่าสุด กันส่งซ้ำ
  const enabled = () => !!(window.FB_CONFIG && FB_CONFIG.apiKey);
  const col = n => st.db.collection('groups').doc(st.gid).collection(n);
  const fp = o => { const s = JSON.stringify(o); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + h; };
  const newGid = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(12)); return [...r].map(x => a[x % a.length]).join(''); };
  const initial = n => (n || '?').trim().charAt(0).toUpperCase();

  async function loadSdk() {
    if (window.firebase?.firestore) return;
    for (const f of ['firebase-app-compat', 'firebase-auth-compat', 'firebase-firestore-compat']) await loadScript(`lib/fb/${f}.js?v=10141`);
  }
  async function signIn() {
    const auth = firebase.auth();
    const u = auth.currentUser || await new Promise(res => { const off = auth.onAuthStateChanged(x => { off(); res(x); }); });
    return u || (await auth.signInAnonymously()).user;
  }
  async function start() {
    stop(); st.err = '';
    if (!enabled() || !st.gid) { render(); return; }
    try {
      await loadSdk();
      if (!firebase.apps.length) { firebase.initializeApp(FB_CONFIG); try { await firebase.firestore().enablePersistence({ synchronizeTabs: true }); } catch {} }
      st.db = firebase.firestore();
      st.uid = (await signIn()).uid;
      col('members').doc(st.uid).set({ uid: st.uid, name: st.me || 'ไม่ระบุชื่อ', seen: Date.now() }, { merge: true }).catch(() => {});
      const watch = (name, key, after) => st.unsub.push(col(name).onSnapshot(snap => {
        st[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!st.first[key]) { st.first[key] = true; after && after(); }
        render();
      }, e => { st.err = e.code === 'permission-denied' ? 'ฐานข้อมูลปฏิเสธการเข้าถึง (ตรวจกฎความปลอดภัยใน Firebase)' : (e.message || String(e)); render(); }));
      watch('pins', 'pins', () => syncAll('pins'));
      watch('catches', 'catches', () => syncAll('catches'));
      watch('members', 'members');
      st.unsub.push(col('meta').doc('info').onSnapshot(d => { if (d.exists && d.data().name) { st.gname = d.data().name; ls.set('group', { id: st.gid, name: st.gname }); render(); } }, () => {}));
      st.ready = true;
    } catch (e) { st.err = navigator.onLine === false ? 'ออฟไลน์ — จะเชื่อมกลุ่มเมื่อมีเน็ต' : (e.message || String(e)); }
    render();
  }
  function stop() { st.unsub.forEach(f => { try { f(); } catch {} }); st.unsub = []; st.ready = false; st.pins = []; st.catches = []; st.members = []; st.first = { pins: false, catches: false }; }

  /* ---------- ส่งของเราขึ้นกลุ่ม ---------- */
  function thumb(src, max = 360) {
    if (!src) return Promise.resolve(null);
    return new Promise(res => { const im = new Image(); im.onload = () => { const s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .6)); }; im.onerror = () => res(null); im.src = src; });
  }
  const spotDoc = s => ({ uid: st.uid, by: st.me || 'ไม่ระบุชื่อ', type: s.type, name: s.name, lat: s.lat, lng: s.lng, fish: s.fish || '', note: s.note || '', fee: s.fee || '', hours: s.hours || '', rules: s.rules || '', tel: s.tel || '' });
  const catchDoc = c => { const sp = S.spots.find(x => x.id === c.spotId); return { uid: st.uid, by: st.me || 'ไม่ระบุชื่อ', species: c.species, len: c.len ?? null, wt: c.wt ?? null, bait: c.bait || '', note: c.note || '', t: c.t, lat: c.lat ?? sp?.lat ?? null, lng: c.lng ?? sp?.lng ?? null, spot: sp?.name || '', released: !!c.released }; };
  async function push(kind, item) {
    if (!st.ready) return;
    const remote = st[kind].find(x => x.id === item.id), key = kind + ':' + item.id;
    if (item.private) { if (remote && remote.uid === st.uid) { await col(kind).doc(item.id).delete().catch(() => {}); delete pushed[key]; ls.set('grpPushed', pushed); } return; }
    if (remote && remote.uid !== st.uid) return;                       // ไอดีชนกับของคนอื่น (แทบเป็นไปไม่ได้) ไม่ทับ
    const doc = kind === 'pins' ? spotDoc(item) : catchDoc(item), f = fp(doc) + ':' + (item.photo ? item.photo.length : 0);
    if (remote && pushed[key] === f) return;
    doc.photo = await thumb(item.photo); doc.updated = Date.now();
    await col(kind).doc(item.id).set(doc).then(() => { pushed[key] = f; ls.set('grpPushed', pushed); }).catch(e => { st.err = e.message; render(); });
  }
  async function drop(kind, id) {
    if (!st.ready) return;
    const remote = st[kind].find(x => x.id === id);
    if (remote && remote.uid === st.uid) await col(kind).doc(id).delete().catch(() => {});
    delete pushed[kind + ':' + id]; ls.set('grpPushed', pushed);
  }
  async function syncAll(kind) {      // ส่งของที่ยังไม่ขึ้น และลบของเราที่ถูกลบในเครื่องไปแล้ว
    if (!st.ready) return;
    const local = kind === 'pins' ? S.spots : S.catches, ids = new Set(local.map(x => x.id));
    for (const x of local) await push(kind, x);
    for (const r of st[kind]) if (r.uid === st.uid && !ids.has(r.id)) await col(kind).doc(r.id).delete().catch(() => {});
  }

  /* ---------- ของเพื่อน ---------- */
  const friendPins = () => st.pins.filter(p => p.uid !== st.uid);
  const friendCatches = () => st.catches.filter(c => c.uid !== st.uid).sort((a, b) => b.t - a.t);
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
      ${n ? `<span>ปลาในกลุ่มแถวนี้</span><b>${n} ตัว</b>` : ''}<span>อัปเดต</span><b>${p.updated ? new Date(p.updated).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-'}</b></div>
    <div class="row">
      <button class="btn acc" id="fpNav">🧭 นำทางด้วยเข็มทิศ</button>
      <a class="btn ghost" href="${gmaps(p)}" target="_blank" rel="noopener">Google Maps</a>
      ${svBtn(p)}
      <button class="btn ghost" id="fpFc">🌤️ พยากรณ์ที่นี่</button>
      <button class="btn ghost" id="fpCopy">📍 เก็บเป็นหมุดของฉัน</button>
    </div>`);
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
    ${c.lat != null ? `<div class="row"><button class="btn acc" id="fcMap">🗺️ ดูบนแผนที่</button><button class="btn ghost" id="fcNav">🧭 นำทางไปจุดนี้</button></div>` : ''}`);
    if (c.lat != null) {
      $('#fcMap').onclick = () => { closeSheet(); showTab('map'); S.follow = false; map.setView([c.lat, c.lng], 15); };
      $('#fcNav').onclick = () => { setTarget({ lat: c.lat, lng: c.lng, name: c.species + ' ของ ' + c.by }); closeSheet(); showTab('tools'); };
    }
  }

  /* ---------- หน้ากลุ่มในแท็บบันทึก ---------- */
  function render() {
    renderMap();
    const el = $('#groupCard'); if (!el) return;
    if (!enabled()) { el.innerHTML = '<div class="sub">ยังไม่ได้เชื่อมเซิร์ฟเวอร์ของกลุ่ม</div>'; return; }
    if (!st.gid) {
      el.innerHTML = `<div class="form" style="margin-top:-6px"><label>ชื่อของคุณในกลุ่ม</label><input id="gMe" value="${esc(st.me)}" placeholder="เช่น ไซลม"></div>
        <div class="row"><button class="btn" id="gNew">สร้างกลุ่มใหม่</button></div>
        <div class="form"><label>หรือเข้ากลุ่มเพื่อนด้วยรหัส</label><input id="gCode" placeholder="รหัสกลุ่ม 12 ตัว" autocapitalize="off" autocomplete="off"></div>
        <div class="row"><button class="btn ghost" id="gJoin">เข้าร่วม</button></div>`;
      $('#gNew').onclick = () => { if (!setMe()) return; const id = newGid(); join(id, `กลุ่มของ ${st.me}`, true); };
      $('#gJoin').onclick = () => { if (!setMe()) return; const code = ($('#gCode').value.match(/[a-z0-9]{8,}/i) || [''])[0].toLowerCase(); if (!code) return toast('ใส่รหัสกลุ่มหรือวางลิงก์ชวน'); join(code); };
      return;
    }
    const fp = friendPins().length, fc = friendCatches();
    el.innerHTML = `<div class="grp-h"><div><b>${esc(st.gname || 'กลุ่มของฉัน')}</b><div class="sub">${st.ready ? (navigator.onLine === false ? 'ออฟไลน์ · จะซิงก์เมื่อมีเน็ต' : 'เชื่อมแล้ว') : st.err ? '' : 'กำลังเชื่อม…'} · คุณคือ ${esc(st.me)}</div></div><button class="btn small" id="gInv">👥 ชวนเพื่อน</button></div>
      ${st.err ? `<div class="warn" style="margin:10px 0 0">${esc(st.err)}</div>` : ''}
      <div class="members">${st.members.map(m => `<span class="mchip"><i>${esc(initial(m.name))}</i>${esc(m.name)}${m.uid === st.uid ? ' (คุณ)' : ''}</span>`).join('')}</div>
      <div class="sub" style="margin-top:8px">หมุดของเพื่อน ${fp} จุด · ปลาของเพื่อน ${fc.length} ตัว · หมุดและปลาของคุณแชร์ให้กลุ่มอัตโนมัติ ยกเว้นที่ตั้งเป็นส่วนตัว</div>
      ${fc.length ? `<div class="card-h" style="margin-top:14px;font-size:15px">ปลาล่าสุดของเพื่อน</div>${fc.slice(0, 15).map(c => `<div class="item" data-fcatch="${c.id}"><div class="th" ${c.photo ? `style="background-image:url(${c.photo})"` : ''}>${c.photo ? '' : '🐟'}</div><div class="mid"><b>${esc(c.species)}${c.wt ? ` ${c.wt} กก.` : c.len ? ` ${c.len} ซม.` : ''}</b><div class="sub">${esc(c.by)} · ${new Date(c.t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}${c.bait ? ' · ' + esc(c.bait) : ''}${c.spot ? ' · ' + esc(c.spot) : ''}</div></div></div>`).join('')}` : ''}
      <div class="row"><button class="btn ghost small" id="gName">เปลี่ยนชื่อ</button><button class="btn ghost small" id="gLeave">ออกจากกลุ่ม</button></div>`;
    $('#gInv').onclick = invite;
    $('#gName').onclick = renameSheet;
    $$('#groupCard [data-fcatch]').forEach(x => x.onclick = () => catchSheetF(x.dataset.fcatch));
    let armed = false;
    $('#gLeave').onclick = e => { if (!armed) { armed = true; e.target.textContent = 'แตะอีกครั้ง: ออกจากกลุ่ม'; return; } leave(); };
  }
  function setMe() { const v = ($('#gMe')?.value || '').trim().slice(0, 24); if (!v) { toast('ใส่ชื่อของคุณก่อน เพื่อนจะได้รู้ว่าหมุดเป็นของใคร'); $('#gMe')?.focus(); return false; } st.me = v; ls.set('myname', v); return true; }
  async function join(id, name, creating) {
    st.gid = id; st.gname = name || ''; ls.set('group', { id, name: st.gname });
    Object.keys(pushed).forEach(k => delete pushed[k]); ls.set('grpPushed', pushed);
    await start();
    if (creating && st.ready) await col('meta').doc('info').set({ uid: st.uid, name: st.gname, created: Date.now() }).catch(() => {});
    toast(creating ? 'สร้างกลุ่มแล้ว กด “ชวนเพื่อน” เพื่อส่งลิงก์' : 'เข้ากลุ่มแล้ว');
  }
  function leave() {
    stop(); st.gid = null; st.gname = ''; ls.set('group', null); render(); toast('ออกจากกลุ่มแล้ว (หมุดในเครื่องยังอยู่ครบ)');
  }
  async function invite() {
    const link = `${location.origin}${location.pathname}#join=${st.gid}`;
    const text = `ชวนเข้ากลุ่ม “${st.gname}” ในพรานปลา — แชร์หมุดตกปลากัน\n${link}\n(รหัสกลุ่ม: ${st.gid})`;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copy(text, 'คัดลอกลิงก์ชวนแล้ว ส่งทาง LINE ได้เลย');
  }
  function renameSheet() {
    openSheet(`<h3>เปลี่ยนชื่อ</h3><div class="form"><label>ชื่อของคุณในกลุ่ม</label><input id="rnMe" value="${esc(st.me)}">
      ${st.gid ? `<label>ชื่อกลุ่ม</label><input id="rnG" value="${esc(st.gname)}">` : ''}</div><div class="row"><button class="btn block acc" id="rnSave">บันทึก</button></div>`);
    $('#rnSave').onclick = async () => {
      const me = $('#rnMe').value.trim().slice(0, 24), g = ($('#rnG')?.value || '').trim().slice(0, 40);
      if (me && me !== st.me) { st.me = me; ls.set('myname', me); Object.keys(pushed).forEach(k => delete pushed[k]); if (st.ready) { col('members').doc(st.uid).set({ uid: st.uid, name: me, seen: Date.now() }, { merge: true }).catch(() => {}); syncAll('pins'); syncAll('catches'); } }
      if (g && g !== st.gname && st.ready) { st.gname = g; ls.set('group', { id: st.gid, name: g }); col('meta').doc('info').set({ uid: st.uid, name: g }, { merge: true }).catch(() => toast('เปลี่ยนชื่อกลุ่มได้เฉพาะคนสร้างกลุ่ม')); }
      closeSheet(); render();
    };
  }
  function joinFromHash() {
    const m = location.hash.match(/^#join=([a-z0-9]{8,})$/i); if (!m) return;
    history.replaceState(null, '', location.pathname);
    const id = m[1].toLowerCase();
    if (!enabled()) return toast('ลิงก์ชวนนี้ใช้ไม่ได้ แอปยังไม่ได้เชื่อมเซิร์ฟเวอร์ของกลุ่ม', 4500);
    if (st.gid === id) return toast('คุณอยู่ในกลุ่มนี้แล้ว');
    openSheet(`<h3>เข้ากลุ่มเพื่อน</h3><div class="sub">หมุดและปลาที่จับได้ของคุณจะแชร์ให้คนในกลุ่มเห็น ยกเว้นที่ตั้งเป็นส่วนตัว${st.gid ? ' · คุณจะออกจากกลุ่มเดิม' : ''}</div>
      <div class="form"><label>ชื่อของคุณในกลุ่ม</label><input id="gMe" value="${esc(st.me)}" placeholder="เช่น ไซลม"></div>
      <div class="row"><button class="btn block acc" id="gGo">เข้าร่วมกลุ่ม</button></div>`);
    $('#gGo').onclick = () => { if (!setMe()) return; closeSheet(); showTab('log'); join(id); };
  }

  window.addEventListener('hashchange', joinFromHash);
  window.addEventListener('online', () => { if (st.gid && !st.ready) start(); else render(); });
  window.addEventListener('offline', render);
  setTimeout(() => { joinFromHash(); start(); }, 0);

  return {
    pushSpot: s => push('pins', s), delSpot: id => drop('pins', id),
    pushCatch: c => push('catches', c), delCatch: id => drop('catches', id),
    syncAll: () => { syncAll('pins'); syncAll('catches'); },
    renderMap, render, pinSheet, catchSheet: catchSheetF,
    get joined() { return !!st.gid; },
    friendPins, friendCatches, st
  };
})();
