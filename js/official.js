const OfficialMap = (() => {
  const $ = (id) => document.getElementById(id);
  const canvas = document.getElementById('om-canvas');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('om-status');

  let manifest = [];
  let current = null;
  let img = null;
  let anchors = [];
  let calib = null;
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
    if (calib.mode === 'tps-loading') return [0, 0];
    if (calib.mode === 'tps') {
      const ref = calib.ref, SC = calib.scale || 5000;
      const mx = ((lng - ref[1]) * 111320) / SC;
      const my = (-(lat - ref[0]) * 110540) / SC;
      let rx = 0, ry = 0;
      const C = calib.ctrlN, W = calib.W, n = C.length;
      for (let i = 0; i < n; i++) {
        const dx = mx - C[i][0], dy = my - C[i][1];
        const u = (dx * dx + dy * dy) * Math.log(Math.sqrt(dx * dx + dy * dy) + 1e-9);
        rx += W[i][0] * u; ry += W[i][1] * u;
      }
      const ax = W[n][0] + W[n + 1][0] * mx + W[n + 2][0] * my;
      const ay = W[n][1] + W[n + 1][1] * mx + W[n + 2][1] * my;
      return [ax + rx, ay + ry];
    }
    if (calib.mode === 'zones') {
      const ref = calib.ref;
      const m = [(lng - ref[1]) * 111320 * Math.cos(ref[0] * Math.PI / 180), -(lat - ref[0]) * 110540];
      let wx = 0, wy = 0, wsum = 0;
      for (const z of calib.zones) {
        const { s, th, ox, oy } = z.params;
        const c = Math.cos(th), si = Math.sin(th);
        const px = ox + s * (c * m[0] - si * m[1]);
        const py = oy + s * (si * m[0] + c * m[1]);
        const d2 = (px - z.center[0]) ** 2 + (py - z.center[1]) ** 2;
        const w = 1 / (d2 + 250000);
        wx += px * w; wy += py * w; wsum += w;
      }
      return [wx / wsum, wy / wsum];
    }
    if (calib.mode === 'affine') {
      return [calib.cx[0] + calib.cx[1] * lat + calib.cx[2] * lng,
              calib.cy[0] + calib.cy[1] * lat + calib.cy[2] * lng];
    }
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
      const n = anchors.length;
      const ref = [anchors.reduce((t, a) => t + a.gps[0], 0) / n,
                   anchors.reduce((t, a) => t + a.gps[1], 0) / n];
      const m = anchors.map((a) => toMeters(a.gps[0], a.gps[1], ref));
      const mm = [m.reduce((t, v) => t + v[0], 0) / n, m.reduce((t, v) => t + v[1], 0) / n];
      const p = anchors.map((a) => a.px);
      const mp = [p.reduce((t, v) => t + v[0], 0) / n, p.reduce((t, v) => t + v[1], 0) / n];
      let a1 = 0, b1 = 0, norm = 0;
      for (let i = 0; i < n; i++) {
        const mx = m[i][0] - mm[0], my = m[i][1] - mm[1];
        const px = p[i][0] - mp[0], py = p[i][1] - mp[1];
        a1 += mx * px + my * py;
        b1 += mx * py - my * px;
        norm += mx * mx + my * my;
      }
      const th = Math.atan2(b1, a1);
      const s = Math.sqrt(a1 * a1 + b1 * b1) / (norm || 1);
      const ox = mp[0] - s * (Math.cos(th) * mm[0] - Math.sin(th) * mm[1]);
      const oy = mp[1] - s * (Math.sin(th) * mm[0] + Math.cos(th) * mm[1]);
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

  async function loadMap(m) {
    current = m;
    img = new Image();
    img.src = `/atlas/${m.file}`;
    await img.decode();
    if (m.seed && m.seed.mode === 'tps') {
      anchors = [];
      calib = { mode: 'tps-loading', ref: [38.14, 140.42] };
      fetch(m.seed.file).then((r) => r.json()).then((tp) => {
        const sc = tp.scale || 5000;
        calib = { mode: 'tps', ref: tp.ref, scale: sc, lam: tp.lam || 0.05, ctrlN: tp.ctrl.map((c) => [c[0] / sc, c[1] / sc]), W: tp.w };
        draw();
      });
    } else if (m.seed && m.seed.mode === 'auto') {
      anchors = m.seed.anchors;
      calib = fitModel(anchors);
    } else if (m.seed && m.seed.mode === 'affine') {
      anchors = [];
      calib = { mode: 'affine', cx: m.seed.cx, cy: m.seed.cy };
    } else if (m.seed) {
      anchors = [];
      calib = { mode: 'poly2', cx: m.seed.c, dy: m.seed.d };
    } else {
      anchors = [];
      calib = null;
    }
    fitCanvas();
    view = fitToScreen();
    refit();
    status.textContent = `${m.name} · 內建校準（3D 手繪圖誤差約 50-300m，精確定位請切「精準地圖」）`;
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


    const saved = localStorage.getItem('snowhere-last-map');
    const first = manifest.find((m) => m.id === saved) || manifest[0];
    picker.value = first.id;
    await loadMap(first);
    draw();
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
