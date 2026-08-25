const OfficialMap = (() => {
  const $ = (id) => document.getElementById(id);
  const canvas = document.getElementById('om-canvas');
  const ctx = canvas.getContext('2d');
  const wizard = document.getElementById('om-wizard');
  const wizStep = document.getElementById('om-wiz-step');
  const wizText = document.getElementById('om-wiz-text');
  const status = document.getElementById('om-status');

  let manifest = [];
  let current = null;
  let img = null;
  let anchors = [];
  let calib = null;
  let calibrating = false;
  let view = { x: 0, y: 0, scale: 1 };
  let lastGps = null;
  let trackPts = [];

  function fitCanvas() {
    const r = canvas.parentElement.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
  }
  window.addEventListener('resize', () => { fitCanvas(); draw(); });

  function imgFromGps(lat, lng) {
    if (!calib) return null;
    if (calib.mode === 'sim') {
      const { s, th, ox, oy } = calib;
      const m = toMeters(lat, lng, calib.ref);
      return [ox + s * (Math.cos(th) * m[0] - Math.sin(th) * m[1]),
              oy + s * (Math.sin(th) * m[0] + Math.cos(th) * m[1])];
    }
    const c = calib.cx, d = calib.dy;
    return [c[0] + c[1] * lat + c[2] * lng + c[3] * lat * lat + c[4] * lng * lng + c[5] * lat * lng,
            d[0] + d[1] * lat + d[2] * lng + d[3] * lat * lat + d[4] * lng * lng + d[5] * lat * lng];
  }

  function toMeters(lat, lng, ref) {
    const kx = 111320 * Math.cos(ref[0] * Math.PI / 180);
    return [(lng - ref[1]) * kx, (ref[0] - lat) * 110540];
  }

  function fitModel(anchors) {
    if (anchors.length < 2) return null;
    if (anchors.length < 6) {
      const [a, b] = anchors;
      const ref = a.gps;
      const m0 = toMeters(a.gps[0], a.gps[1], ref);
      const m1 = toMeters(b.gps[0], b.gps[1], ref);
      const vImg = [b.px[0] - a.px[0], b.px[1] - a.px[1]];
      const vMet = [m1[0] - m0[0], m1[1] - m0[1]];
      const s = Math.hypot(...vImg) / (Math.hypot(...vMet) || 1);
      const th = Math.atan2(vImg[1], vImg[0]) - Math.atan2(vMet[1], vMet[0]);
      const ox = a.px[0] - s * (Math.cos(th) * m0[0] - Math.sin(th) * m0[1]);
      const oy = a.px[1] - s * (Math.sin(th) * m0[0] + Math.cos(th) * m0[1]);
      return { mode: 'sim', s, th, ox, oy, ref };
    }
    const A = anchors.map((a) => [1, a.gps[0], a.gps[1], a.gps[0] ** 2, a.gps[1] ** 2, a.gps[0] * a.gps[1]]);
    const solve = (ys) => {
      const AT = mathT(A), ATA = matMul(AT, A);
      return matVec(matInv(ATA), matMulVec(AT, ys));
    };
    return { mode: 'poly2', cx: solve(anchors.map((a) => a.px[0])), dy: solve(anchors.map((a) => a.px[1])) };
  }

  function mathT(A) {
    const R = A[0].length, C = A.length;
    const T = Array.from({ length: R }, () => Array(C).fill(0));
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) T[i][j] = A[j][i];
    return T;
  }
  function matMul(A, B) {
    const n = A.length, m = B[0].length, k = B.length;
    const R = Array.from({ length: n }, () => Array(m).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (let x = 0; x < k; x++) R[i][j] += A[i][x] * B[x][j];
    return R;
  }
  function matMulVec(A, v) { return A.map((row) => row.reduce((s, a, i) => s + a * v[i], 0)); }
  function matInv(M) {
    const n = M.length;
    const aug = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let i = 0; i < n; i++) {
      let piv = aug[i][i];
      if (Math.abs(piv) < 1e-12) piv = aug[i][i] = 1e-12;
      for (let j = 0; j < n * 2; j++) aug[i][j] /= piv;
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const f = aug[k][i];
        for (let j = 0; j < n * 2; j++) aug[k][j] -= f * aug[i][j];
      }
    }
    return aug.map((row) => row.slice(n));
  }

  function draw() {
    if (!img) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    ctx.drawImage(img, 0, 0);

    if (calib && lastGps) {
      const p = imgFromGps(lastGps.lat, lastGps.lng);
      if (p) {
        const [ix, iy] = p;
        ctx.beginPath();
        ctx.arc(ix, iy, Math.max(6, (lastGps.acc || 10) / metersPerPixel()), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(33,150,243,.18)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(33,150,243,.9)';
        ctx.lineWidth = 2 / view.scale;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ix, iy, 9 / view.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#2196f3';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3 / view.scale;
        ctx.fill(); ctx.stroke();
        if (trackPts.length > 1) {
          ctx.beginPath();
          trackPts.forEach((t, i) => {
            const q = imgFromGps(t[0], t[1]);
            i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
          });
          ctx.strokeStyle = '#ff5470';
          ctx.lineWidth = 3.5 / view.scale;
          ctx.stroke();
        }
      }
    }
    if (calibrating) {
      anchors.forEach((a) => {
        ctx.beginPath();
        ctx.arc(a.px[0], a.px[1], 7 / view.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#f5a524';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 / view.scale;
        ctx.fill(); ctx.stroke();
      });
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function metersPerPixel() {
    if (!calib || !lastGps) return 1;
    const p1 = imgFromGps(lastGps.lat, lastGps.lng);
    const p2 = imgFromGps(lastGps.lat, lastGps.lng + 0.001);
    return Math.abs(p2[0] - p1[0]) / (0.001 * 111320 * Math.cos(lastGps.lat * Math.PI / 180)) || 1;
  }

  function refit() {
    if (anchors.length >= 2) calib = fitModel(anchors);
    else if (!calib && current && current.seed) calib = { mode: 'poly2', cx: current.seed.c, dy: current.seed.d };
    if (current) localStorage.setItem('snowhere-anchors-' + current.id, JSON.stringify(anchors));
    draw();
  }

  function screenToImage(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left - view.x) / view.scale, (e.clientY - r.top - view.y) / view.scale];
  }

  function toast2(msg, isErr) { if (window.toast) window.toast(msg, isErr); }
  let drag = null, pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (calibrating) {
      if (!lastGps) { toast2('還沒有 GPS 定位——先按右上角「開始定位」', true); return; }
      const px = screenToImage(e);
      anchors.push({ px, gps: [lastGps.lat, lastGps.lng] });
      updateWizard();
      refit();
      if (anchors.length >= (calib ? 7 : 2)) setCalibrating(false);
      return;
    }
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.x = drag.vx + (e.clientX - drag.x);
    view.y = drag.vy + (e.clientY - drag.y);
    draw();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    view.x = mx - (mx - view.x) * f;
    view.y = my - (my - view.y) * f;
    view.scale *= f;
    draw();
  }, { passive: false });

  function updateWizard() {
    const n = anchors.length;
    if (n === 0) { wizStep.textContent = '校準 1 / 2'; wizText.innerHTML = '站定在一個好認的位置，<b>點地圖上你所在的位置</b>。'; }
    else if (n === 1) { wizStep.textContent = '校準 2 / 2'; wizText.innerHTML = '很好！移動到<b>雪場另一端</b>（越遠越準），再點一次。'; }
    else { wizStep.textContent = `已記錄 ${n} 個校正點`; wizText.innerHTML = '繼續點擊可再精修（點越多越準），或按「完成」結束校準。';
      if (!document.getElementById('om-wiz-done')) {
        const b = document.createElement('button');
        b.id = 'om-wiz-done'; b.className = 'ghost-btn'; b.textContent = '完成';
        b.onclick = () => setCalibrating(false);
        document.querySelector('.om-wiz-row').appendChild(b);
      }
    }
  }

  function setCalibrating(on) {
    calibrating = on;
    wizard.hidden = !on;
    if (on) { anchors = []; refit(); updateWizard(); }
    else {
      const done = document.getElementById('om-wiz-done');
      if (done) done.remove();
      if (anchors.length >= 2) toast(`校準完成——已記錄 ${anchors.length} 個校正點`);
    }
  }

  async function loadMap(m) {
    current = m;
    img = new Image();
    img.src = `/atlas/${m.file}`;
    await img.decode();
    anchors = [];
    try { anchors = JSON.parse(localStorage.getItem('snowhere-anchors-' + m.id) || '[]'); } catch {}
    calib = null;
    if (m.seed) {
      calib = { mode: 'poly2', cx: m.seed.c, dy: m.seed.d };
    }
    fitCanvas();
    view = fitToScreen();
    refit();
    status.textContent = m.seed
      ? `${m.name} · 內建概略校準（誤差可能 100-300m）——按 🎯 兩點校準可精修`
      : `${m.name} · 尚未校準——按 🎯 開始兩點校準`;
    status.hidden = false;
    draw();
  }

  function fitToScreen() {
    const s = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.96;
    return { scale: s, x: (canvas.width - img.width * s) / 2, y: (canvas.height - img.height * s) / 2 };
  }

  async function init() {
    fitCanvas();
    manifest = await fetch('/atlas/manifest.json').then((r) => r.json());
    const picker = document.createElement('select');
    picker.id = 'om-picker';
    picker.className = 'om-picker';
    picker.setAttribute('aria-label', '選擇雪場地圖');
    for (const m of manifest) {
      const o = document.createElement('option');
      o.value = m.id; o.textContent = m.name;
      picker.appendChild(o);
    }
    picker.addEventListener('change', () => loadMap(manifest.find((m) => m.id === picker.value)));
    document.querySelector('.om-stage').prepend(picker);

    $('btn-om-recal').addEventListener('click', () => setCalibrating(true));
    $('om-wiz-cancel').addEventListener('click', () => setCalibrating(false));

    const saved = localStorage.getItem('snowhere-last-map');
    const first = manifest.find((m) => m.id === saved) || manifest[0];
    picker.value = first.id;
    await loadMap(first);
  }

  function redraw() { fitCanvas(); if (img) { if (!view.scale || view.scale === 1) view = fitToScreen(); draw(); } }

  window.__omDebug = () => ({
    hasImg: !!img, hasCalib: !!calib, calibMode: calib ? calib.mode : null,
    lastGps, anchors: anchors.length,
    dot: lastGps && calib ? imgFromGps(lastGps.lat, lastGps.lng) : null,
    view, canvasW: canvas.width, canvasH: canvas.height,
  });

  return {
    init,
    redraw,
    onGps(gps, track) { lastGps = gps; trackPts = track; if (img && calib) draw(); },
    get currentId() { return current ? current.id : null; },
  };
})();
window.OfficialMap = OfficialMap;
OfficialMap.init();
