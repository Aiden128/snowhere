#!/usr/bin/env python3
"""Independent landmark check for the Zao TPS model.

Projects named aerialway midpoints through the SAME math as js/official.js,
crops a neighbourhood around each projection, and draws a red cross at the
projected position. Visual inspection of the crops tells whether the model
puts real GPS coordinates on the drawn lift infrastructure.
"""
import argparse
import json

import cv2
import numpy as np


def load_model(path):
    tp = json.load(open(path))
    return (np.array(tp['ref']), float(tp['scale']),
            np.array(tp['ctrl'], float), np.array(tp['w'], float))


def project(model, lat, lng):
    ref, scale, ctrl, w = model
    n = len(ctrl)
    mx = (lng - ref[1]) * 111320.0
    my = -(lat - ref[0]) * 110540.0
    qn = np.array([mx / scale, my / scale])
    cn = ctrl / scale
    dx = qn[0] - cn[:, 0]; dy = qn[1] - cn[:, 1]
    u = (dx * dx + dy * dy) * np.log(np.sqrt(dx * dx + dy * dy) + 1e-9)
    rx = float((w[:n, 0] * u).sum()); ry = float((w[:n, 1] * u).sum())
    ax = w[n, 0] + w[n + 1, 0] * qn[0] + w[n + 2, 0] * qn[1]
    ay = w[n, 1] + w[n + 1, 1] * qn[0] + w[n + 2, 1] * qn[1]
    return ax + rx, ay + ry


CHECKS = {
    'sanroku_station': '蔵王ロープウェイ山麓線',
    'jubaku_station': None,
    'chocho_station': '鳥兜駅',
    'omori_lift': '大森クワトロ',
    'yokokura_lift': '横倉第１ペア',
    'paradise_lift': 'パラダイス第３ペア',
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--geom', default='/tmp/opencode/zao-geom.json')
    ap.add_argument('--map', default='atlas/zao.jpg')
    ap.add_argument('--model', default='atlas/zao-tps.json')
    ap.add_argument('--outdir', default='/tmp/opencode/checks')
    args = ap.parse_args()

    import os
    os.makedirs(args.outdir, exist_ok=True)
    img = cv2.imread(args.map)
    mh, mw = img.shape[:2]
    model = load_model(args.model)

    geom = json.load(open(args.geom))
    by_name = {}
    for el in geom['elements']:
        t = el.get('tags', {})
        name = t.get('name')
        if not name or not ('piste:type' in t or 'aerialway' in t):
            continue
        g = el.get('geometry', [])
        if not g:
            continue
        lats = [p['lat'] for p in g]; lngs = [p['lon'] for p in g]
        by_name.setdefault(name, []).append(
            (float(np.mean(lats)), float(np.mean(lngs))))

    targets = []
    for key, want in CHECKS.items():
        if key == 'jubaku_station':
            cands = [(n, pts) for n, pts in by_name.items() if '樹氷' in n or '樹冰' in n]
            if not cands:
                print(f'{key}: NO OSM FEATURE FOUND'); continue
            name, pts = cands[0]
        else:
            if want not in by_name:
                print(f'{key}: {want} NOT FOUND'); continue
            name, pts = want, by_name[want]
        for j, (lat, lng) in enumerate(pts):
            targets.append((f'{key}_{j}', name, lat, lng))

    report = {}
    for slug, name, lat, lng in targets:
        px, py = project(model, lat, lng)
        ix, iy = int(px), int(py)
        ok = 60 <= ix < mw - 60 and 60 <= iy < mh - 60
        report[slug] = {'name': name, 'gps': [round(lat, 5), round(lng, 5)],
                        'px': [ix, iy], 'in_bounds': ok}
        if not ok:
            print(f'{slug} OUT OF BOUNDS ({ix},{iy})'); continue
        x0, y0 = max(ix - 220, 0), max(iy - 220, 0)
        crop = img[y0:y0 + 440, x0:x0 + 440].copy()
        cx, cy = ix - x0, iy - y0
        cv2.drawMarker(crop, (cx, cy), (0, 0, 255), cv2.MARKER_CROSS, 36, 3)
        cv2.circle(crop, (cx, cy), 22, (0, 0, 255), 2)
        cv2.imwrite(f'{args.outdir}/{slug}.jpg', crop)
        print(f'{slug} [{name}] gps({lat:.5f},{lng:.5f}) -> ({ix},{iy})')

    json.dump(report, open(f'{args.outdir}/report.json', 'w'),
              ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
