'use strict';
/* ชุดไอคอนเส้นของพรานปลา: แปลงอีโมจิในหน้าจอเป็น SVG อัตโนมัติ (ข้อความที่แชร์ออกไปยังเป็นอีโมจิตามเดิม) */
const CLOUD = 'M7 17a4 4 0 1 1 .9-7.9A5 5 0 0 1 17.5 10a3.5 3.5 0 0 1-.5 7';
const ICONS = {
  '🌧': [`<path d="${CLOUD}"/><path d="M8 19.5v2M12 19v3M16 19.5v2"/>`, '#3b82f6'],
  '🌦': [`<path d="${CLOUD}"/><path d="M9 19.5v2M14 19.5v2"/>`, '#60a5fa'],
  '⛈': [`<path d="${CLOUD}"/><path d="m13 15-3 4h4l-2 3.5"/>`, '#8b5cf6'],
  '🌫': ['<path d="M4 9h16M6 13h12M4 17h16"/>'],
  '☀': ['<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7"/>', '#f5a623'],
  '🌤': ['<circle cx="8" cy="8" r="3"/><path d="M8 2v1.5M2 8h1.5M3.8 3.8l1 1M12.2 3.8l-1 1"/><path d="M10 19.5a3.5 3.5 0 1 1 .8-6.9 4.5 4.5 0 0 1 8.2 1.4 2.8 2.8 0 0 1-.5 5.5Z"/>', '#f5a623'],
  '⛅': ['<circle cx="8" cy="8" r="3"/><path d="M8 2v1.5M2 8h1.5M3.8 3.8l1 1M12.2 3.8l-1 1"/><path d="M10 19.5a3.5 3.5 0 1 1 .8-6.9 4.5 4.5 0 0 1 8.2 1.4 2.8 2.8 0 0 1-.5 5.5Z"/>'],
  '☁': [`<path d="${CLOUD}Z"/>`],
  '🌙': ['<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"/>'],
  '💧': ['<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>', '#38a5f5'],
  '🎚': ['<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'],
  '⚙': ['<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/><circle cx="12" cy="12" r="6.5"/>'],
  '🔔': ['<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'],
  '↔': ['<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>'],
  '📍': ['<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>'],
  '🐟': ['<path d="M2.5 12s3.5-5.5 9-5.5 8 5.5 8 5.5-2.5 5.5-8 5.5-9-5.5-9-5.500Z"/><path d="m18 12 3.5-3.500v7L18 12Z"/><path d="M7 11.200v.100"/>'],
  '🎣': ['<circle cx="14.5" cy="4" r="1.6"/><path d="M14.5 5.600V14a5 5 0 0 1-10 0v-3.500l3.2 3.2"/>'],
  '🎯': ['<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 12v.100"/>'],
  '🌊': ['<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>', '#38a5f5'],
  '🔥': ['<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.5 2 2.500C11 9 10.5 6 12 3Z"/>', '#f97316'],
  '⬇': ['<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'],
  '⬆': ['<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>'],
  '👣': ['<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>'],
  '✅': ['<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>', '#22c55e'],
  '🗺': ['<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14"/>'],
  '⚠': ['<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4.500M12 17.300v.100"/>', '#f59e0b'],
  '🧭': ['<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>'],
  '📤': ['<path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/>'],
  '↩': ['<path d="M8 6 3 11l5 5M3 11h11a5 5 0 0 1 0 10h-3"/>'],
  '💨': ['<path d="M3 9h10a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7"/>'],
  '🌅': ['<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 7v3M5 11l2 2M19 11l-2 2"/>', '#f5a623'],
  '🆘': ['<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.600M14.8 14.800l3.6 3.600M18.4 5.600l-3.6 3.600M9.2 14.800l-3.6 3.6"/>', '#ef4444'],
  '🔦': ['<path d="M8 3h8l-2 5v11a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V8L8 3ZM10 8h4M12 12v2"/>'],
  '🛰': ['<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'],
  '⛰': ['<path d="M3 19 9 8l4 6 2-3 6 8H3Z"/>'],
  '🔎': ['<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'],
  '🔍': ['<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'],
  '🔴': ['<circle cx="12" cy="12" r="5" fill="currentColor"/>', '#ef4444'],
  '🥵': ['<path d="M12 4a2 2 0 0 0-2 2v8a4 4 0 1 0 4 0V6a2 2 0 0 0-2-2Z"/>', '#ef4444'],
  '🌂': ['<path d="M3 12a9 9 0 0 1 18 0H3ZM12 12v7a2 2 0 0 0 4 0"/>'],
  '⏱': ['<path d="M4 16a8 8 0 1 1 16 0M12 16l4-5"/>'],
  '🪱': ['<path d="M14 3v10a4 4 0 0 1-8 0v-2M14 3l2 2"/>'],
  '⏰': ['<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
  '⛺': ['<path d="M3 19 12 5l9 14H3ZM9 19l3-5 3 5"/>'],
  '🚗': ['<path d="M4 16v-3l2-5h12l2 5v3H4ZM6.5 16v2M17.5 16v2M5 13h14"/>'],
  '🚰': ['<path d="M6 9h12l-1.5 11h-9L6 9ZM9 5h6M12 5v4"/>'],
  '🏪': ['<path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M10 20v-6h4v6"/>'],
  '🍂': ['<path d="M5 19C5 10 10 5 20 4c-1 10-6 15-15 15ZM5 19l8-8"/>'],
  '🍃': ['<path d="M5 19C5 10 10 5 20 4c-1 10-6 15-15 15ZM5 19l8-8"/>'],
  '📡': ['<path d="M12 12v.100M8.5 15.500a5 5 0 0 1 0-7M15.5 8.500a5 5 0 0 1 0 7M5.6 18.400a9 9 0 0 1 0-12.800M18.4 5.600a9 9 0 0 1 0 12.8"/>'],
  '📢': ['<path d="M4 10v4h3l6 4V6l-6 4H4ZM16.5 9a4 4 0 0 1 0 6"/>'],
  '⬜': ['<rect x="5" y="5" width="14" height="14" rx="3"/>'],
  '🟥': ['<rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor"/>', '#ef4444'],
  '☎': ['<path d="M6 3h3l1.5 5-2 1.500a12 12 0 0 0 6 6l1.5-2 5 1.500v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z"/>'],
  '🎒': ['<path d="M8 8V6a4 4 0 0 1 8 0v2M5 8h14v12H5V8ZM9 14h6"/>'],
  '🚶': ['<circle cx="12" cy="4.5" r="2"/><path d="M12 7.5v6l-3 7M12 13.5l3.5 7M8 10.5l4-2 3.5 3"/>'],
  '👥': ['<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.5M17.5 13.5a5 5 0 0 1 3 5"/>'],
  '🔒': ['<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'],
  '📱': ['<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>']
};
const ICON_RE = new RegExp('(' + Object.keys(ICONS).sort((a, b) => b.length - a.length).join('|') + ')\\uFE0F?', 'u');
function iconEl(k) {
  const [p, col] = ICONS[k], s = document.createElement('span'); s.className = 'i';
  s.innerHTML = `<svg viewBox="0 0 24 24"${col ? ` style="color:${col}"` : ''}>${p}</svg>`; return s;
}
function iconize(root) {
  if (!root || (root.nodeType !== 1 && root.nodeType !== 3)) return;
  const nodes = [];
  if (root.nodeType === 3) nodes.push(root);
  else { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); while (w.nextNode()) nodes.push(w.currentNode); }
  for (const n of nodes) {
    const par = n.parentElement; if (!par || par.closest('textarea,script,style,option,title,.i,.noicon')) continue;
    let node = n, m;
    while (node && (m = ICON_RE.exec(node.nodeValue))) {
      const rest = node.splitText(m.index); rest.nodeValue = rest.nodeValue.slice(m[0].length);
      rest.parentNode.insertBefore(iconEl(m[1]), rest); node = rest;
    }
  }
}
iconize(document.body);
new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') iconize(m.target); else m.addedNodes.forEach(iconize); } })
  .observe(document.body, { childList: true, subtree: true, characterData: true });
