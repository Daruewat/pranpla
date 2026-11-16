'use strict';
/* สไตล์แผนที่เวกเตอร์ของพรานปลา (ข้อมูล OpenStreetMap ผ่าน OpenFreeMap, โครงสร้าง OpenMapTiles) */
const VEC_PAL = {
  dark: { bg: '#0e1a16', wood: '#11261c', grass: '#132a1e', farm: '#101f19', resid: '#14211d', park: '#15321f', water: '#165a8c', river: '#2277b3', wet: '#123a3a',
    bld: '#1c2c27', minor: '#2b3c36', mid: '#3d4f47', major: '#566a5f', hwy: '#7a7a4a', path: '#4a5d54', rail: '#3a4742', bnd: '#4d6258',
    tx: '#dbe6df', tx2: '#9fb2a8', halo: '#0b1210', wtx: '#8fd0ff', poi: '#c9d6a0' },
  light: { bg: '#f1f3ec', wood: '#cfe3c4', grass: '#dcebcf', farm: '#ebeedd', resid: '#e9e9e2', park: '#c3e0b5', water: '#9cc8ee', river: '#7fb6e6', wet: '#c5e3dc',
    bld: '#dcd9d0', minor: '#ffffff', mid: '#fff6d6', major: '#ffe49a', hwy: '#f6b86a', path: '#b89a78', rail: '#a9a9a9', bnd: '#9a8fb0',
    tx: '#1d2a23', tx2: '#55665d', halo: '#ffffff', wtx: '#0b5a94', poi: '#4c6a1f' }
};
function vecStyle(theme) {
  const c = VEC_PAL[theme] || VEC_PAL.dark, NAME = ['coalesce', ['get', 'name:th'], ['get', 'name'], ['get', 'name:latin']];
  const road = (id, cls, color, w, minzoom, extra = {}) => ({ id, type: 'line', source: 'o', 'source-layer': 'transportation', minzoom, filter: ['all', ['in', 'class', ...cls], ['!=', 'brunnel', 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], ...w], ...extra } });
  const label = (id, sl, filter, size, color, minzoom, extra = {}, font = 'Noto Sans Regular') => ({ id, type: 'symbol', source: 'o', 'source-layer': sl, minzoom, ...(filter ? { filter } : {}),
    layout: { 'text-field': NAME, 'text-font': [font], 'text-size': size, 'text-max-width': 9, 'text-padding': 4, ...extra }, paint: { 'text-color': color, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } });
  return {
    version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { o: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap · OpenFreeMap' } },
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
      { id: 'water', type: 'fill', source: 'o', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'water-edge', type: 'line', source: 'o', 'source-layer': 'water', minzoom: 12, paint: { 'line-color': c.river, 'line-width': 1 } },
      { id: 'bld', type: 'fill', source: 'o', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': c.bld } },
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
