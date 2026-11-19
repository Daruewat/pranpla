'use strict';
/* ============ หมายเด็ด: คะแนนหมาย · หมายเด็ดใกล้ฉัน · ข้อมูลหมายสายช่อน · โหวตหมาย ============ */
const HOT = (() => {
  const HAB = ['กอบัว', 'คลองข้างทาง', 'ร่องสวน', 'หนองน้ำ', 'นาข้าว', 'ลำห้วย', 'อ่าง/เขื่อน', 'บ่อขุด'];
  const PARK = ['จอดรถได้', 'จอดข้างทาง', 'ไม่มีที่จอด'];
  const WALK = ['ติดถนน', 'เดิน < 100 ม.', 'เดิน 100–500 ม.', 'เดินไกล > 500 ม.'];
  const BAITS = ['กบยาง', 'เหยื่อผิวน้ำ', 'สปินเนอร์เบท', 'ปลาเป็น', 'กบเป็น', 'หนอนยาง', 'ใบหลิว'];
  const NEAR = 150, DAY = 864e5;
  const isChon = c => /ช่อน/.test(c.species || '');
  const agoTxt = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 60 ? `${Math.max(m, 1)} นาทีก่อน` : m < 1440 ? `${Math.round(m / 60)} ชม.ก่อน` : `${Math.round(m / 1440)} วันก่อน`; };
  const st = () => grp('st') || {};
  const myUid = () => st().uid;

  /* หมายทั้งหมดที่เห็น: ของเรา + ของเพื่อน */
  function allSpots() {
    const own = S.spots.map(s => ({ ...s, mine: true }));
    const fr = (grp('friendPins') || []).map(p => ({ ...p, mine: false }));
    return [...own, ...fr];
  }
  /* ปลาทุกตัวที่รู้ (ของเรา + ชุมชน) ไม่ซ้ำ */
  function allCatches() {
    const m = new Map();
    S.catches.forEach(c => m.set(c.id, c));
    (st().catches || []).forEach(c => { if (!m.has(c.id)) m.set(c.id, c); });
    return [...m.values()];
  }
  const votesOf = id => (st().votes || []).filter(v => v.post === id);

  /* คะแนนความเด็ด 0–100: ปลาที่จับได้จริงแถวหมาย (ใหม่ = หนักกว่า, ช่อน/ตัวใหญ่ = หนักกว่า) + โหวตล่าสุด */
  function stats(s) {
    const now = Date.now(), cs = allCatches().filter(c => (c.spotId === s.id) || (c.lat != null && s.lat != null && dist(c, s) < NEAR)).filter(c => now - c.t < 60 * DAY).sort((a, b) => b.t - a.t);
    const vs = votesOf(s.id);
    let raw = 0;
    cs.forEach(c => { raw += Math.exp(-(now - c.t) / DAY / 14) * (isChon(c) ? 1.2 : .8) * (1 + Math.min(+c.wt || 0, 4) / 8); });
    vs.forEach(v => { raw += Math.exp(-(now - v.t) / DAY / 5) * (v.v > 0 ? .8 : -1); });
    const score = raw <= 0 ? 0 : Math.round(100 * (1 - Math.exp(-raw / 2.2)));
    const up = vs.filter(v => v.v > 0), down = vs.filter(v => v.v < 0), lastV = [...vs].sort((a, b) => b.t - a.t)[0];
    const lvl = score >= 65 ? 3 : score >= 35 ? 2 : score >= 10 ? 1 : 0;
    const label = !cs.length && !vs.length ? 'ยังไม่มีข้อมูล' : ['ยังเงียบ', 'มีลุ้น', 'กำลังกิน', 'เด็ดมาก'][lvl];
    return { score, lvl, label, catches: cs, chon: cs.filter(isChon).length, up: up.length, down: down.length, lastV, my: vs.find(v => v.uid === myUid())?.v || 0 };
  }
  const badge = (x, big) => `<span class="hotb l${x.lvl}${big ? ' big' : ''}">${x.lvl === 3 ? '🔥 ' : ''}${x.label}${x.score ? ` · ${x.score}` : ''}</span>`;

  /* แผงในหน้าหมาย: คะแนน + โหวต + ข้อมูลหมายสายช่อน */
  function details(s) {
    const rows = [];
    if (s.hab?.length) rows.push(`<span>ลักษณะหมาย</span><b>${s.hab.map(esc).join(' · ')}</b>`);
    if (s.park) rows.push(`<span>ที่จอดรถ</span><b>${esc(s.park)}</b>`);
    if (s.walk) rows.push(`<span>การเดินเข้า</span><b>${esc(s.walk)}</b>`);
    if (s.baits) rows.push(`<span>เหยื่อที่ได้ผล</span><b>${esc(s.baits)}</b>`);
    return rows.length ? `<div class="kv">${rows.join('')}</div>` : '';
  }
  function panel(s) {
    const x = stats(s), last = x.catches[0];
    return `<div class="hotp" id="hotPanel">
      <div class="hotp-top">${badge(x, true)}<span class="sub">${x.catches.length ? `ปลา ${x.catches.length} ตัวใน 60 วัน${x.chon ? ` (ช่อน ${x.chon})` : ''}` : 'ยังไม่มีใครบันทึกปลาที่หมายนี้'}</span></div>
      ${last ? `<div class="sub hotp-last">ตัวล่าสุด: ${esc(last.species || 'ปลา')}${last.wt ? ` ${last.wt} กก.` : ''} · ${agoTxt(last.t)}</div>` : ''}
      <div class="hotp-vote"><span class="sub">ไปมาล่าสุดเป็นยังไง?</span>
        <div class="row"><button class="btn ghost small vbtn${x.my > 0 ? ' on up' : ''}" data-vote="1">🔥 ยังกินอยู่ ${x.up || ''}</button><button class="btn ghost small vbtn${x.my < 0 ? ' on down' : ''}" data-vote="-1">😴 เงียบแล้ว ${x.down || ''}</button></div>
        ${x.lastV ? `<span class="sub">โหวตล่าสุด ${agoTxt(x.lastV.t)}</span>` : ''}</div>
      ${details(s)}</div>`;
  }
  function bindPanel(s, rerender) {
    $$('#hotPanel [data-vote]').forEach(b => b.onclick = async () => {
      const v = +b.dataset.vote, cur = stats(s).my;
      const r = await grp('vote', s.id, cur === v ? 0 : v);
      if (r === 'login') return toast('เข้าสู่ระบบก่อนถึงจะโหวตหมายได้');
      if (r === 'private') return toast('หมายนี้ตั้งเป็นส่วนตัว คนอื่นโหวตไม่ได้ เปิดแชร์ก่อนถึงจะโหวตได้');
      rerender();
    });
  }
  function refreshPanel(s) { const el = $('#hotPanel'); if (!el) return; el.outerHTML = panel(s); bindPanel(s, () => refreshPanel(s)); }

  /* หมายเด็ดใกล้ฉัน */
  let sortBy = 'hot';
  function listSheet() {
    const me = S.pos || map.getCenter();
    const items = allSpots().filter(s => s.lat != null).map(s => ({ s, x: stats(s), d: dist(me, s) })).filter(o => o.d < 80000);
    items.sort(sortBy === 'hot' ? (a, b) => b.x.score - a.x.score || a.d - b.d : (a, b) => a.d - b.d);
    openSheet(`<h3>🔥 หมายเด็ด${S.pos ? 'ใกล้ฉัน' : 'แถวนี้'}</h3>
      <div class="seg" id="hotSort"><button data-s="hot" class="${sortBy === 'hot' ? 'sel' : ''}">เด็ดสุด</button><button data-s="near" class="${sortBy === 'near' ? 'sel' : ''}">ใกล้สุด</button></div>
      <div class="hotlist">${items.length ? items.slice(0, 40).map(({ s, x, d }) => { const t = SPOT_TYPES[s.type] || SPOT_TYPES.other, last = x.catches[0];
        return `<button class="hotrow" data-id="${s.id}" data-mine="${s.mine ? 1 : 0}"><span class="hotico l${x.lvl}">${t.icon}</span><span class="hotmain"><b>${esc(s.name || t.label)}</b><span class="sub">${fmtDist(d)}${s.mine ? '' : ` · ${esc(s.by || '')}`}${last ? ` · ${esc(last.species || 'ปลา')} ${agoTxt(last.t)}` : ''}${x.up || x.down ? ` · 🔥${x.up} 😴${x.down}` : ''}</span></span>${badge(x)}</button>`; }).join('')
        : '<div class="empty small">ยังไม่มีหมายในรัศมี 80 กม. ปักหมุดหมายแรกได้จากปุ่ม ＋</div>'}</div>`);
    $$('#hotSort button').forEach(b => b.onclick = () => { sortBy = b.dataset.s; listSheet(); });
    $$('.hotlist .hotrow').forEach(b => b.onclick = () => {
      const s = allSpots().find(x => x.id === b.dataset.id); if (!s) return;
      showTab('map'); S.follow = false; map.setView([s.lat, s.lng], Math.max(map.getZoom(), 15));
      b.dataset.mine === '1' ? spotSheet(s.id) : grp('pinSheet', s.id);
    });
  }

  /* ฟอร์มหมุด: ช่องข้อมูลสายช่อน */
  function formHtml(d) {
    const chips = (name, list, cur, multi) => `<div class="types hchips" data-hname="${name}" data-multi="${multi ? 1 : 0}">${list.map(v => `<button type="button" data-v="${esc(v)}" class="${(multi ? (cur || []).includes(v) : cur === v) ? 'sel' : ''}">${esc(v)}</button>`).join('')}</div>`;
    return `<details class="hform" ${d.hab?.length || d.park || d.walk || d.baits ? 'open' : ''}><summary>ข้อมูลหมายสายช่อน (ไม่บังคับ)</summary>
      <label>ลักษณะหมาย (เลือกได้หลายอย่าง)</label>${chips('hab', HAB, d.hab, true)}
      <label>ที่จอดรถ</label>${chips('park', PARK, d.park)}
      <label>การเดินเข้า</label>${chips('walk', WALK, d.walk)}
      <label>เหยื่อที่ได้ผล</label><input name="baits" list="baitList" value="${esc(d.baits || '')}" placeholder="เช่น กบยาง, เหยื่อผิวน้ำ"><datalist id="baitList">${BAITS.map(b => `<option value="${b}">`).join('')}</datalist></details>`;
  }
  function bindForm(r, d) {
    $$('.hchips', r).forEach(g => $$('button', g).forEach(b => b.onclick = () => {
      const k = g.dataset.hname, v = b.dataset.v;
      if (g.dataset.multi === '1') { d[k] = d[k] || []; d[k] = d[k].includes(v) ? d[k].filter(x => x !== v) : [...d[k], v]; b.classList.toggle('sel'); }
      else { d[k] = d[k] === v ? '' : v; $$('button', g).forEach(x => x.classList.toggle('sel', x === b && d[k] === v)); }
      d._draft?.();
    }));
  }

  /* เครื่องหมายบนแผนที่ */
  const markClass = s => { const l = stats(s).lvl; return l ? ` hot${l}` : ''; };
  return { stats, panel, bindPanel, refreshPanel, listSheet, formHtml, bindForm, markClass, details, badge, HAB };
})();
window.HOT = HOT;
renderSpots();
