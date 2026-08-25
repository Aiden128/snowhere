const RESORTS = fetch('/data/resorts.json').then((r) => r.json());

const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([36.5, 138.5], 5);
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
L.control.attribution({ position: 'bottomleft', prefix: '' })
  .addAttribution('© OpenStreetMap · Esri · OpenTopoMap').addTo(map);

const layers = {
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 }),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 }),
};
layers.osm.addTo(map);

L.control.layers({
  '🗺️ 標準地圖': layers.osm,
  '🛰️ 衛星': layers.sat,
  '⛰️ 地形圖': layers.topo,
}, null, { position: 'topright' }).addTo(map);

const $ = (id) => document.getElementById(id);
window.toast = toast;
const toastEl = $('toast');
let toastTimer;
function toast(msg, isErr = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('is-err', isErr);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4200);
}

const R_EARTH = 6371000;
function distM(lat1, lng1, lat2, lng2) {
  const p = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * p / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin((lng2 - lng1) * p / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

const resortMarkers = [];
let highlight = null;

RESORTS.then((resorts) => {
  window.__RESORTS = resorts;
  for (const r of resorts) {
    const label = r.zh || r.en || r.ja;
    const sub = [r.en && r.zh ? r.en : '', r.pref].filter(Boolean).join(' · ');
    const m = L.circleMarker([r.lat, r.lng], {
      radius: 4, color: '#4fc3f7', weight: 1.5,
      fillColor: '#4fc3f7', fillOpacity: .25,
    }).addTo(map);
    m.bindTooltip(`<b>${label}</b>${sub ? `<span style="color:#9aa5b5"> ${sub}</span>` : ''}`, { direction: 'top' });
    m.on('click', () => flyToResort(r));
    resortMarkers.push({ r, m });
  }
});

function flyToResort(r) {
  const zoom = r.r > 8000 ? 12 : r.r > 3000 ? 13 : 14;
  map.flyTo([r.lat, r.lng], zoom, { duration: 1.2 });
  L.popup({ maxWidth: 260 }).setLatLng([r.lat, r.lng])
    .setContent(`<b>${r.zh || r.en || r.ja}</b><br><span style="color:#9aa5b5">${[r.en, r.pref].filter(Boolean).join(' · ')}</span>`)
    .addTo(map);
}

function setBanner(label, name) {
  $('banner').hidden = false;
  $('banner-label').textContent = label;
  $('banner-name').textContent = name;
}

function detectResort(lat, lng) {
  const resorts = window.__RESORTS || [];
  let inside = null;
  let nearest = null;
  let nearestD = Infinity;
  for (const r of resorts) {
    const d = distM(lat, lng, r.lat, r.lng);
    if (d <= r.r && (!inside || r.r < inside.r)) inside = r;
    if (d < nearestD) { nearestD = d; nearest = r; }
  }
  if (highlight) { map.removeLayer(highlight); highlight = null; }
  if (inside) {
    setBanner('你目前在', `${inside.zh || inside.en || inside.ja}`);
    highlight = L.circle([inside.lat, inside.lng], {
      radius: inside.r, color: '#4fc3f7', weight: 1.5, dashArray: '6 8', fill: false,
    }).addTo(map);
  } else if (nearest && nearestD < 60000) {
    setBanner('不在收錄雪場範圍內', `最近：${nearest.zh || nearest.en || nearest.ja}（${(nearestD / 1000).toFixed(1)} km）`);
  } else {
    setBanner('不在日本滑雪區附近', '—');
  }
  return inside;
}

const userDot = L.marker([36.5, 138.5], {
  icon: L.divIcon({ className: 'user-dot-wrap', html: '<div class="user-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
  zIndexOffset: 1000,
});
const accCircle = L.circle([36.5, 138.5], { radius: 0, color: '#4fc3f7', weight: 1, fillColor: '#4fc3f7', fillOpacity: .12 });
let follow = true;
let watchId = null;

map.on('dragstart', () => { follow = false; });

$('btn-loc').addEventListener('click', () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    $('btn-loc').textContent = '📍 開始定位';
    $('btn-loc').classList.remove('is-on');
    toast('已停止定位');
    return;
  }
  if (!navigator.geolocation) { toast('這個瀏覽器不支援定位', true); return; }
  $('btn-loc').textContent = '⏳ 定位中…';
  watchId = navigator.geolocation.watchPosition(onFix, onErr, {
    enableHighAccuracy: true, maximumAge: 4000, timeout: 20000,
  });
  toast('定位中——請允許瀏覽器使用你的位置');
});

let firstFix = true;
function onFix(pos) {
  const { latitude: lat, longitude: lng, accuracy, altitude, speed } = pos.coords;
  userDot.setLatLng([lat, lng]).addTo(map);
  accCircle.setLatLng([lat, lng]).setRadius(accuracy).addTo(map);

  $('hud').hidden = false;
  $('hud-acc').textContent = Math.round(accuracy);
  $('hud-coord').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  $('hud-alt').textContent = altitude != null ? Math.round(altitude) : '—';
  $('hud-spd').textContent = speed != null ? (speed * 3.6).toFixed(1) : '—';

  detectResort(lat, lng);
  pushTrack(lat, lng, accuracy);
  if (window.OfficialMap) OfficialMap.onGps({ lat, lng, acc: accuracy }, track);

  if (firstFix) {
    firstFix = false;
    $('btn-loc').textContent = '⏸ 停止定位';
    $('btn-loc').classList.add('is-on');
  }
  if (follow) map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true });
}

function onErr(e) {
  const msgs = {
    1: '定位被拒絕——請在瀏覽器設定允許此頁使用位置（iPhone：設定 → Safari → 位置）',
    2: '收不到 GPS 訊號——到戶外空曠處再試',
    3: '定位逾時——再試一次',
  };
  toast(msgs[e.code] || `定位錯誤：${e.message}`, true);
  if (e.code === 1) { $('btn-loc').textContent = '📍 開始定位'; }
}

$('btn-center').addEventListener('click', () => {
  if (lastFix) { follow = true; map.flyTo([lastFix.lat, lastFix.lng], Math.max(map.getZoom(), 15)); }
  else toast('還沒有定位資料——先按「開始定位」');
});

let lastFix = null;

const TRACK_KEY = 'snowhere-track';
let track = [];
try { track = JSON.parse(localStorage.getItem(TRACK_KEY) || '[]'); } catch { track = []; }
let recording = false;
let trackLine = track.length ? L.polyline(track, { color: '#ff5470', weight: 4, opacity: .85 }).addTo(map) : null;
let trackDist = trackDistOf(track);

function trackDistOf(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return d;
}

function pushTrack(lat, lng, accuracy) {
  lastFix = { lat, lng };
  if (!recording || accuracy > 60) return;
  const last = track[track.length - 1];
  if (last && distM(last[0], last[1], lat, lng) < 4) return;
  track.push([lat, lng]);
  if (!trackLine) trackLine = L.polyline([], { color: '#ff5470', weight: 4, opacity: .85 }).addTo(map);
  trackLine.setLatLngs(track);
  try { localStorage.setItem(TRACK_KEY, JSON.stringify(track)); } catch {}
}

$('btn-track').addEventListener('click', () => {
  recording = !recording;
  $('btn-track').classList.toggle('is-rec', recording);
  toast(recording ? '開始記錄軌跡 ⛷️' : `軌跡已停止——總距離 ${(trackDistOf(track) / 1000).toFixed(2)} km`);
});

$('btn-clear').addEventListener('click', () => {
  track = [];
  trackDist = 0;
  if (trackLine) { map.removeLayer(trackLine); trackLine = null; }
  try { localStorage.removeItem(TRACK_KEY); } catch {}
  toast('軌跡已清除');
});

const searchEl = $('search');
const resultsEl = $('search-results');
searchEl.addEventListener('input', () => {
  const q = searchEl.value.trim().toLowerCase();
  if (!q || !window.__RESORTS) { resultsEl.hidden = true; return; }
  const hits = window.__RESORTS.filter((r) =>
    [r.zh, r.en, r.ja, r.pref].some((f) => f && f.toLowerCase().includes(q))
  ).slice(0, 8);
  resultsEl.innerHTML = '';
  for (const r of hits) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="r-zh">${r.zh || r.ja}</span><span class="r-sub">${[r.en, r.pref].filter(Boolean).join(' · ')}</span>`;
    li.addEventListener('click', () => {
      resultsEl.hidden = true;
      searchEl.value = '';
      follow = false;
      flyToResort(r);
    });
    resultsEl.appendChild(li);
  }
  resultsEl.hidden = hits.length === 0;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) resultsEl.hidden = true;
});

const tabOfficial = document.getElementById('tab-official');
const tabOsm = document.getElementById('tab-osm');

function setMode(mode) {
  const official = mode === 'official';
  tabOfficial.classList.toggle('is-active', official);
  tabOsm.classList.toggle('is-active', !official);
  tabOfficial.setAttribute('aria-selected', String(official));
  tabOsm.setAttribute('aria-selected', String(!official));
  document.getElementById('official-view').hidden = !official;
  document.getElementById('map').hidden = official;
  document.querySelector('.map-tools').hidden = official;
  document.querySelector('.search-box').hidden = official;
  document.getElementById('hud').hidden = official || !$('hud-coord').textContent.includes(',');
  if (official && window.OfficialMap) {
    if (!window.__omInited) { window.__omInited = true; OfficialMap.init(); }
    requestAnimationFrame(() => OfficialMap.redraw());
    OfficialMap.onGps(lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : track.length ? track[track.length - 1] : null, track);
  }
  localStorage.setItem('snowhere-mode', mode);
}

tabOfficial.addEventListener('click', () => setMode('official'));
tabOsm.addEventListener('click', () => setMode('osm'));

const savedMode = localStorage.getItem('snowhere-mode');
if (savedMode === 'official') setMode('official');
