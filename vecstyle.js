'use strict';
/* สไตล์แผนที่เวกเตอร์ของพรานปลา (ข้อมูล OpenStreetMap ผ่าน OpenFreeMap, โครงสร้าง OpenMapTiles) */
const OPEN_BLD = 'https://data.source.coop/vida/google-microsoft-open-buildings/pmtiles/go_ms_building_footprints.pmtiles';
const VEC_PAL = {
  dark: { bg: '#0d1a1c', wood: '#10261f', grass: '#122a22', farm: '#0f1f1d', resid: '#13221f', park: '#123024', water: '#1d6a73', river: '#2a8f97', wet: '#113331',
    bld: '#1f3835', bldo: '#2f504b', minor: '#243b38', mid: '#30504b', major: '#41675f', hwy: '#7d6a3e', path: '#3a5550', rail: '#2b403c', bnd: '#456660',
    tx: '#dfe9e5', tx2: '#8ea4a2', halo: '#0c1719', wtx: '#7fd9cd', poi: '#a9c1a6' },
  light: { bg: '#f1f3ec', wood: '#cfe3c4', grass: '#dcebcf', farm: '#ebeedd', resid: '#e9e9e2', park: '#c3e0b5', water: '#9cc8ee', river: '#7fb6e6', wet: '#c5e3dc',
    bld: '#d9d0c1', bldo: '#bfb3a0', minor: '#ffffff', mid: '#fff6d6', major: '#ffe49a', hwy: '#f6b86a', path: '#b89a78', rail: '#a9a9a9', bnd: '#9a8fb0',
    tx: '#1d2a23', tx2: '#55665d', halo: '#ffffff', wtx: '#0b5a94', poi: '#4c6a1f' }
};
VEC_PAL.terrain = { ...VEC_PAL.light, bg: '#e2f4e8', farm: '#e2f4e8', grass: '#d5efdd', wood: '#c9e8d3', park: '#c4e6cf', resid: '#eceeec', wet: '#cfeadf', water: '#a9d6f0', river: '#86c1e8', bld: '#dcdcd6', bldo: '#c6c6bf' };
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
/* ภูมิประเทศแบบ Google: พื้นเขียวมิ้นต์ + เงาภูเขา + เส้นชั้นความสูง + ถนน/ชื่อไทย */
function terrainStyle() {
  const st = vecStyle('terrain'), at = st.layers.findIndex(l => l.id === 'water');
  const dem = window._dem;
  st.sources.dem = { type: 'raster-dem', encoding: 'terrarium', tiles: [dem ? dem.sharedDemProtocolUrl : DEM_URL], tileSize: 256, maxzoom: 12, attribution: 'ความสูง: Mapzen Terrain Tiles (AWS)' };
  const add = [{ id: 'hill', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': .55, 'hillshade-shadow-color': '#2e4a3b', 'hillshade-highlight-color': 'rgba(255,255,255,.45)', 'hillshade-accent-color': '#3f5c4c', 'hillshade-illumination-direction': 315 } }];
  if (dem) {
    st.sources.ct = { type: 'vector', tiles: [dem.contourProtocolUrl({ thresholds: { 10: [200, 1000], 11: [100, 500], 12: [50, 200], 13: [20, 100], 14: [20, 100], 15: [10, 50] }, contourLayer: 'c', elevationKey: 'ele', levelKey: 'lv', overzoom: 1 })], maxzoom: 15 };
    add.push({ id: 'ct', type: 'line', source: 'ct', 'source-layer': 'c', minzoom: 10, paint: { 'line-color': '#5d7a68', 'line-opacity': ['match', ['get', 'lv'], 1, .45, .22], 'line-width': ['match', ['get', 'lv'], 1, 1, .6] } });
    st.layers.push({ id: 'ct-lb', type: 'symbol', source: 'ct', 'source-layer': 'c', minzoom: 12, filter: ['>', ['get', 'lv'], 0], layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'ele']], 'm'], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-padding': 30 }, paint: { 'text-color': '#6f8778', 'text-halo-color': '#e2f4e8', 'text-halo-width': 1.2 } });
  }
  st.layers.splice(at < 0 ? 1 : at, 0, ...add);
  return st;
}
function vecStyle(theme) {
  const c = VEC_PAL[theme] || VEC_PAL.dark, NAME = ['coalesce', ['get', 'name:th'], ['get', 'name'], ['get', 'name:latin']];
  const road = (id, cls, color, w, minzoom, extra = {}) => ({ id, type: 'line', source: 'o', 'source-layer': 'transportation', minzoom, filter: ['all', ['in', 'class', ...cls], ['!=', 'brunnel', 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], ...w], ...extra } });
  const label = (id, sl, filter, size, color, minzoom, extra = {}, font = 'Noto Sans Regular') => ({ id, type: 'symbol', source: 'o', 'source-layer': sl, minzoom, ...(filter ? { filter } : {}),
    layout: { 'text-field': NAME, 'text-font': [font], 'text-size': size, 'text-max-width': 9, 'text-padding': 4, ...extra }, paint: { 'text-color': color, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } });
  return {
    version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { o: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap · OpenFreeMap' },
      wfix: { type: 'geojson', data: new URL('waterfix.json?v=1', location.href).href },   // อ่างเก็บน้ำที่ข้อมูล OSM ขาด (เช่น อ่างแม่กวง) วาดเติมเอง
      ...(window._pmProto ? { gb: { type: 'vector', url: 'pmtiles://' + OPEN_BLD, attribution: 'อาคาร: Google Open Buildings · Microsoft' } } : {}) },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
      { id: 'resid', type: 'fill', source: 'o', 'source-layer': 'landuse', filter: ['in', 'class', 'residential', 'commercial', 'industrial', 'retail'], paint: { 'fill-color': c.resid } },
      { id: 'farm', type: 'fill', source: 'o', 'source-layer': 'landcover', filter: ['==', 'class', 'farmland'], paint: { 'fill-color': c.farm } },
      { id: 'grass', type: 'fill', source: 'o', 'source-layer': 'landcover', filter: ['==', 'class', 'grass'], paint: { 'fill-color': c.grass } },
      { id: 'wood', type: 'fill', source: 'o', 'source-layer': 'landcover', filter: ['==', 'class', 'wood'], paint: { 'fill-color': c.wood } },
      { id: 'park', type: 'fill', source: 'o', 'source-layer': 'park', paint: { 'fill-color': c.park, 'fill-opacity': .6 } },
      { id: 'wetland', type: 'fill', source: 'o', 'source-layer': 'landcover', filter: ['==', 'class', 'wetland'], paint: { 'fill-color': c.wet } },
      { id: 'stream', type: 'line', source: 'o', 'source-layer': 'waterway', minzoom: 11, filter: ['in', 'class', 'stream', 'ditch', 'drain'], paint: { 'line-color': c.river, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, .6, 16, 2.2] } },
      { id: 'river', type: 'line', source: 'o', 'source-layer': 'waterway', filter: ['in', 'class', 'river', 'canal'], layout: { 'line-cap': 'round' }, paint: { 'line-color': c.river, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 13, 3, 17, 8] } },
      { id: 'water-fix', type: 'fill', source: 'wfix', paint: { 'fill-color': c.water } },
      { id: 'water', type: 'fill', source: 'o', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'water-edge', type: 'line', source: 'o', 'source-layer': 'water', minzoom: 12, paint: { 'line-color': c.river, 'line-width': 1 } },
      ...(window._pmProto ? [{ id: 'gbld', type: 'fill', source: 'gb', 'source-layer': 'building_footprints', minzoom: 14, paint: { 'fill-color': c.bld, 'fill-outline-color': c.bldo } }] : []),   // อาคารที่ OSM ยังไม่มี (ข้อมูลเปิด Google + Microsoft)
      { id: 'bld', type: 'fill', source: 'o', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': c.bld, 'fill-outline-color': c.bldo } },
      { id: 'path', type: 'line', source: 'o', 'source-layer': 'transportation', minzoom: 13, filter: ['in', 'class', 'path', 'track'], paint: { 'line-color': c.path, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, .8, 18, 2.5], 'line-dasharray': [2, 1.5] } },
      road('minor', ['minor', 'service'], c.minor, [12, .6, 15, 3, 19, 14], 12),
      road('mid', ['tertiary', 'secondary'], c.mid, [9, .7, 13, 2.6, 19, 20], 9),
      road('major', ['primary', 'trunk'], c.major, [7, .8, 12, 3, 19, 24], 6),
      road('hwy', ['motorway'], c.hwy, [6, 1, 12, 3.5, 19, 26], 5),
      { id: 'rail', type: 'line', source: 'o', 'source-layer': 'transportation', minzoom: 10, filter: ['==', 'class', 'rail'], paint: { 'line-color': c.rail, 'line-width': 1.4, 'line-dasharray': [4, 3] } },
      { id: 'bnd', type: 'line', source: 'o', 'source-layer': 'boundary', filter: ['all', ['<=', 'admin_level', 4], ['!=', 'maritime', 1]], paint: { 'line-color': c.bnd, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, .6, 12, 1.6], 'line-dasharray': [3, 2] } },
      label('waterway-name', 'waterway', null, 12, c.wtx, 12, { 'symbol-placement': 'line', 'text-letter-spacing': .08 }, 'Noto Sans Italic'),
      label('water-name', 'water_name', null, ['interpolate', ['linear'], ['zoom'], 9, 11, 15, 15], c.wtx, 9, {}, 'Noto Sans Italic'),
      label('road-name', 'transportation_name', null, 11, c.tx2, 14, { 'symbol-placement': 'line' }),
      label('peak', 'mountain_peak', null, 11, c.poi, 11),
      label('poi', 'poi', ['<=', 'rank', 12], 11, c.poi, 15),
      label('hamlet', 'place', ['in', 'class', 'hamlet', 'isolated_dwelling', 'neighbourhood', 'quarter'], 11.5, c.tx2, 13),
      label('village', 'place', ['in', 'class', 'village', 'suburb'], ['interpolate', ['linear'], ['zoom'], 10, 11, 15, 14], c.tx, 10.5),
      label('town', 'place', ['==', 'class', 'town'], ['interpolate', ['linear'], ['zoom'], 7, 11, 14, 17], c.tx, 7, {}, 'Noto Sans Bold'),
      label('city', 'place', ['==', 'class', 'city'], ['interpolate', ['linear'], ['zoom'], 5, 12, 12, 20], c.tx, 4, {}, 'Noto Sans Bold'),
      label('state', 'place', ['in', 'class', 'state', 'province'], 12, c.tx2, 5, { 'text-transform': 'uppercase', 'text-letter-spacing': .1 })
    ]
  };
}

/* ดาวเทียม + ถนน + ชื่อภาษาไทย: ภาพถ่ายจริงจาก Esri เห็นหลังคาบ้าน แล้ววางเส้นถนนและชื่อจาก OpenStreetMap ทับ */
const ESRI_IMG = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
function hybridStyle() {
  const NAME = ['coalesce', ['get', 'name:th'], ['get', 'name'], ['get', 'name:latin']], halo = 'rgba(0,0,0,.85)';
  const road = (id, cls, color, w, minzoom, op = .9) => ({ id, type: 'line', source: 'o', 'source-layer': 'transportation', minzoom, filter: ['all', ['in', 'class', ...cls], ['!=', 'brunnel', 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-opacity': op, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], ...w] } });
  const label = (id, sl, filter, size, color, minzoom, extra = {}, font = 'Noto Sans Regular') => ({ id, type: 'symbol', source: 'o', 'source-layer': sl, minzoom, ...(filter ? { filter } : {}),
    layout: { 'text-field': NAME, 'text-font': [font], 'text-size': size, 'text-max-width': 9, 'text-padding': 4, ...extra }, paint: { 'text-color': color, 'text-halo-color': halo, 'text-halo-width': 1.8 } });
  return {
    version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      img: { type: 'raster', tiles: [ESRI_IMG], tileSize: (window.devicePixelRatio || 1) >= 1.5 ? 128 : 256, maxzoom: 18,   // จอมือถือความละเอียดสูง: ดึงภาพซูมสูงกว่า 1 ขั้น ให้คมเท่าจอ
      attribution: 'ภาพ: Esri, Maxar' },
      o: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap · OpenFreeMap' }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b1a14' } },
      { id: 'img', type: 'raster', source: 'img', paint: { 'raster-fade-duration': 150 } },
      { id: 'river', type: 'line', source: 'o', 'source-layer': 'waterway', minzoom: 10, filter: ['in', 'class', 'river', 'canal', 'stream'], paint: { 'line-color': '#5fd0ff', 'line-opacity': .55, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .6, 16, 2.5] } },
      { id: 'path', type: 'line', source: 'o', 'source-layer': 'transportation', minzoom: 14, filter: ['in', 'class', 'path', 'track'], paint: { 'line-color': '#f1d9a8', 'line-opacity': .7, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, .8, 18, 2.2], 'line-dasharray': [2, 1.5] } },
      road('minor', ['minor', 'service'], '#ffffff', [12, .5, 15, 1.6, 19, 7], 12, .55),
      road('mid', ['tertiary', 'secondary'], '#fff3c4', [9, .6, 13, 1.8, 19, 10], 9, .8),
      road('major', ['primary', 'trunk'], '#ffd76a', [7, .8, 12, 2.2, 19, 13], 6),
      road('hwy', ['motorway'], '#ffb347', [6, 1, 12, 2.6, 19, 15], 5),
      label('waterway-name', 'waterway', null, 12, '#9fe6ff', 13, { 'symbol-placement': 'line' }, 'Noto Sans Italic'),
      label('water-name', 'water_name', null, ['interpolate', ['linear'], ['zoom'], 9, 11, 15, 15], '#9fe6ff', 9, {}, 'Noto Sans Italic'),
      label('road-name', 'transportation_name', null, 11.5, '#ffffff', 14, { 'symbol-placement': 'line' }),
      label('poi', 'poi', ['<=', 'rank', 14], 11.5, '#ffe9b0', 15),
      label('hamlet', 'place', ['in', 'class', 'hamlet', 'isolated_dwelling', 'neighbourhood', 'quarter'], 12, '#e8f2ee', 12),
      label('village', 'place', ['in', 'class', 'village', 'suburb'], ['interpolate', ['linear'], ['zoom'], 10, 11.5, 15, 15], '#ffffff', 10, {}, 'Noto Sans Bold'),
      label('town', 'place', ['==', 'class', 'town'], ['interpolate', ['linear'], ['zoom'], 7, 12, 14, 18], '#ffffff', 7, {}, 'Noto Sans Bold'),
      label('city', 'place', ['==', 'class', 'city'], ['interpolate', ['linear'], ['zoom'], 5, 13, 12, 21], '#ffffff', 4, {}, 'Noto Sans Bold')
    ]
  };
}
