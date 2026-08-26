#!/usr/bin/env python3
"""Zao full-resort TPS calibration.

Pipeline:
  1. Load OSM piste/aerialway geometry (Overpass dump) -> local meters frame
  2. Bootstrap similarity transform from 3 hand-verified peaks
  3. Growing ICP against Canny/distance-transform of the map (thresholds widen
     each round; diagnostics printed; guarded against empty match sets)
  4. Normalized-kernel TPS (distances divided by SCALE) solved via lstsq
  5. Lambda hyperparameter chosen by 25% block hold-out (fixed per-model dims)
  6. Model saved with FULL-PRECISION weights; runtime mirrors this exactly

Usage: python3 scripts/zao-register.py --geom /tmp/opencode/zao-geom.json \
         --map atlas/zao.jpg --out atlas/zao-tps.json --overlay atlas/zao-overlay.jpg
"""
import argparse
import json

import cv2
import numpy as np

# Local meters frame shared with js/official.js runtime (no cos(lat): the
# transform absorbs it; runtime MUST NOT multiply cos either).
REF_LAT, REF_LNG = 38.14, 140.42
M_LAT = 110540.0
M_LNG = 111320.0
SCALE = 5000.0          # kernel-space normalization (meters)
MAP_SPAN_M = 3500.0     # approx horizontal meters covered by the map drawing


def to_meters(lat, lng):
    return np.column_stack([(np.asarray(lng) - REF_LNG) * M_LNG,
                            -(np.asarray(lat) - REF_LAT) * M_LAT])


def load_osm_points(path):
    geom = json.load(open(path))
    lats, lngs = [], []
    for el in geom.get('elements', []):
        tags = el.get('tags', {})
        if 'piste:type' in tags or 'aerialway' in tags:
            for g in el.get('geometry', []):
                lats.append(g['lat']); lngs.append(g['lon'])
    return to_meters(np.array(lats), np.array(lngs))


def bootstrap_similarity(M):
    boot_gps = np.array([[38.1277, 140.4482],
                         [38.1439, 140.4398],
                         [38.1520, 140.4320]])
    boot_px = np.array([[1881, 621], [1575, 578], [1404, 793]], float)
    m3 = to_meters(boot_gps[:, 0], boot_gps[:, 1])
    sm, sp = m3.mean(0), boot_px.mean(0)
    mc, pc = m3 - sm, boot_px - sp
    U, S, Vt = np.linalg.svd(mc.T @ pc)
    R = Vt.T @ U.T
    if np.linalg.det(R) < 0:
        Vt[-1] *= -1
        R = Vt.T @ U.T
    s0 = S.sum() / (mc ** 2).sum()
    t0 = sp - s0 * (R @ mc.T).T.sum(0)
    return (s0 * (R @ M.T)).T + t0


def dedup(ctrl, disp):
    """Drop duplicate control points -> avoids singular kernel rows."""
    seen, keep = {}, []
    for i, c in enumerate(np.round(ctrl, 1)):
        k = (float(c[0]), float(c[1]))
        if k not in seen:
            seen[k] = True
            keep.append(i)
    return np.array(keep, dtype=int)


def fit_tps(ctrl_m, disp_px, lam):
    """Fit TPS in NORMALIZED kernel space via lstsq. Returns model dict or None."""
    uid = dedup(ctrl_m, disp_px)
    ctrl_m, disp_px = ctrl_m[uid], disp_px[uid]
    n = len(ctrl_m)
    if n < 3:
        return None
    cn = ctrl_m / SCALE
    D = np.sqrt(((cn[None, :, :] - cn[:, None, :]) ** 2).sum(-1))
    K = (D * D) * np.log(D + 1e-9)
    Pm = np.column_stack([np.ones(n), cn])
    L = np.zeros((n + 3, n + 3))
    L[:n, :n] = K
    L[np.arange(n), np.arange(n)] += lam
    L[:n, n:] = Pm
    L[n:, :n] = Pm.T
    Y = np.zeros((n + 3, 2))
    Y[:n] = disp_px
    try:
        W = np.linalg.lstsq(L, Y, rcond=None)[0]
    except np.linalg.LinAlgError:
        return None
    return {'ctrl': ctrl_m, 'lam': lam, 'W': W}


def apply_tps(model, q_m):
    ctrl = model['ctrl']; W = model['W']; n = len(ctrl)
    qn = np.asarray(q_m, float) / SCALE
    cn = ctrl / SCALE
    out = np.zeros((len(qn), 2))
    for i in range(n):
        dx = qn[:, 0] - cn[i, 0]; dy = qn[:, 1] - cn[i, 1]
        u = (dx * dx + dy * dy) * np.log(np.sqrt(dx * dx + dy * dy) + 1e-9)
        out[:, 0] += W[i, 0] * u; out[:, 1] += W[i, 1] * u
    out[:, 0] += W[n, 0] + W[n + 1, 0] * qn[:, 0] + W[n + 2, 0] * qn[:, 1]
    out[:, 1] += W[n, 1] + W[n + 1, 1] * qn[:, 0] + W[n + 2, 1] * qn[:, 1]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--geom', default='/tmp/opencode/zao-geom.json')
    ap.add_argument('--map', default='atlas/zao.jpg')
    ap.add_argument('--out', default='atlas/zao-tps.json')
    ap.add_argument('--overlay', default='atlas/zao-overlay.jpg')
    args = ap.parse_args()

    img = cv2.imread(args.map)
    mh, mw = img.shape[:2]
    mpp = 3500.0 / mw
    edges = cv2.Canny(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), 50, 150)
    ds = 4
    thick = cv2.dilate(edges, np.ones((2, 2), np.uint8))
    small = cv2.resize(thick, (mw // ds, mh // ds), interpolation=cv2.INTER_AREA)
    small = ((small > 40) * 255).astype(np.uint8)
    dt = cv2.distanceTransform(255 - small, cv2.DIST_L2, 3)

    M = load_osm_points(args.geom)
    print(f'OSM points: {len(M)}, map {mw}x{mh}, mpp {mpp:.2f}')

    # Hard anchors: authoritative GPS <-> map pixel pairs.
    # Peaks: Nominatim nodes cross-checked against OCR'd label positions;
    # Jizochō summit label located visually (two independent crops agreed);
    # Jūhyō-kōgen station sits mid-way on the DRAWN ropeway (OSM aerialway
    # geometry proved broken here: its base-station node is km off);
    # town/bus-terminal from prior visual verification.
    ANCHORS = [
        ([38.14389, 140.43976], (1602, 585), 20),
        ([38.12775, 140.44820], (1881, 621), 5),
        ([38.15201, 140.43196], (1204, 751), 20),
        ([38.15179, 140.41006], (1394, 1257), 2),
        ([38.15700, 140.43350], (1537, 1979), 2),
    ]
    A_m = np.array([to_meters(np.array([g[0]]), np.array([g[1]]))[0] for g, _, _ in ANCHORS])
    A_px = np.array([px for _, px, _ in ANCHORS], float)
    A_wt = np.array([w for _, _, w in ANCHORS])

    cur = bootstrap_similarity(M)

    def project(c):
        xi = np.clip((c[:, 0] / mw * (mw // ds)).astype(int), 0, mw // ds - 1)
        yi = np.clip((c[:, 1] / mh * (mh // ds)).astype(int), 0, mh // ds - 1)
        return xi, yi, dt[yi, xi]

    model = None
    keep = np.zeros(len(M), bool)
    for rnd, th in enumerate([6, 10, 15, 22, 32, 45]):
        xi, yi, dv = project(cur)
        keep = dv < th
        nk = int(keep.sum())
        msg = f'round {rnd} th={th}px: matched {nk}/{len(M)}'
        if nk >= 20:
            rep = np.maximum(A_wt // 2, 1)
            C_m = np.vstack([M[keep]] + [np.repeat(A_m[i:i+1], rep[i], axis=0) for i in range(len(A_m))])
            T_px = np.vstack([np.column_stack([xi[keep] * ds, yi[keep] * ds])]
                             + [np.repeat(A_px[i:i+1], rep[i], axis=0) for i in range(len(A_px))])
            cand = fit_tps(C_m, T_px, 0.05)
            if cand is not None:
                model = cand
                cur = apply_tps(model, M)
                _, _, dv2 = project(cur)
                msg += f' -> post mean {dv2[keep].mean():.1f}px'
            else:
                msg += ' (fit skipped)'
        else:
            msg += ' (too few, skip)'
        print(msg)

    if model is None:
        raise SystemExit('ICP never converged; aborting without writing output')

    xi, yi, _ = project(cur)
    proj_all = cur[keep].copy()
    ctrl_all = M[keep]
    disp_all = proj_all.copy()

    # Spatial thinning: >=THIN_M spacing between controls. Dense clouds let TPS
    # interpolate each point from its own neighbours -> hold-out leakage.
    THIN_M = 60.0
    order = np.argsort(-np.linalg.norm(disp_all, axis=1))
    chosen, cell_seen = [], {}
    CELL = THIN_M
    for i in order:
        key = (int(ctrl_all[i, 0] // CELL), int(ctrl_all[i, 1] // CELL))
        if key in cell_seen:
            continue
        cell_seen[key] = True
        chosen.append(i)
    sel = np.array(sorted(chosen))
    ctrl_all, disp_all, proj_all = ctrl_all[sel], disp_all[sel], proj_all[sel]
    print(f'thinned control pool: {len(ctrl_all)} (>= {THIN_M:.0f}m spacing)')

    # Spatially blocked hold-out: remove whole 400m grid cells (25% of them).
    # Interleaved hold-out leaks when controls stay dense.
    rng = np.random.default_rng(42)
    cells = np.column_stack([ctrl_all[:, 0] // 400, ctrl_all[:, 1] // 400])
    uniq_cells = np.unique(cells, axis=0)
    held_cells = set(map(tuple, uniq_cells[rng.random(len(uniq_cells)) < 0.25]))
    held = np.array([tuple(c) in held_cells for c in cells])
    print(f'blocked hold-out: {held.sum()}/{len(ctrl_all)} pts in '
          f'{len(held_cells)} removed cells')

    best = (np.inf, None)
    for lam in (0.005, 0.02, 0.05, 0.2, 0.5, 2.0):
        mo = fit_tps(ctrl_all[~held], disp_all[~held], lam)
        if mo is None:
            continue
        pred = apply_tps(mo, ctrl_all[held])
        truth = disp_all[held]
        err = np.linalg.norm(pred - truth, axis=1) * mpp
        print(f'lam {lam}: hold-out({int(held.sum())}) median {np.median(err):.1f}m '
              f'mean {err.mean():.1f}m p90 {np.percentile(err, 90):.1f}m')
        if np.median(err) < best[0]:
            best = (float(np.median(err)), lam)
    lam_star = best[1]
    print(f'lambda* = {lam_star} (hold-out median {best[0]:.1f}m)')

    final = fit_tps(ctrl_all, disp_all, lam_star)
    out = {
        'mode': 'tps',
        'ref': [REF_LAT, REF_LNG],
        'scale': SCALE,
        'lam': float(lam_star),
        'ctrl': np.round(final['ctrl'], 1).tolist(),
        'w': [[float(a), float(b)] for a, b in final['W']],
    }
    with open(args.out, 'w') as f:
        json.dump(out, f)
    import os
    print(f'wrote {args.out} ({os.path.getsize(args.out)//1024} KB, '
          f'{len(final["ctrl"])} ctrl)')

    vis = img.copy()
    proj = apply_tps(final, M)
    ok = 0
    for i in range(len(M)):
        x, y = int(proj[i, 0]), int(proj[i, 1])
        if 0 <= x < mw and 0 <= y < mh:
            cv2.circle(vis, (x, y), 3, (0, 0, 255), -1)
            ok += 1
    cv2.imwrite(args.overlay, vis)
    print(f'overlay: {ok}/{len(M)} projected in-bounds -> {args.overlay}')


if __name__ == '__main__':
    main()
