import json, math, sys
import numpy as np
import cv2

LAT0, LNG0, LAT1, LNG1 = 38.10, 140.38, 38.20, 140.52
RW, RH = 1600, 1600

def proj(lat, lng):
    return [(lng - LNG0) / (LNG1 - LNG0) * RW, (LAT1 - lat) / (LAT1 - LAT0) * RH]

def unproj(x, y):
    return [LAT1 - y / RH * (LAT1 - LAT0), LNG0 + x / RW * (LNG1 - LNG0)]

geom = json.load(open('/tmp/opencode/zao-geom.json'))
pistes = [e for e in geom['elements'] if 'piste:type' in e.get('tags', {})]
lifts = [e for e in geom['elements'] if 'aerialway' in e.get('tags', {})]

ref = np.full((RH, RW, 3), 45, np.uint8)
for e in pistes:
    pts = np.array([proj(p['lat'], p['lon']) for p in e['geometry']], np.int32)
    diff = e['tags'].get('piste:difficulty')
    col = (60, 220, 120) if diff == 'easy' else (60, 160, 255) if diff == 'intermediate' else (255, 255, 255)
    cv2.polylines(ref, [pts], False, col, 3, cv2.LINE_AA)
for e in lifts:
    pts = np.array([proj(p['lat'], p['lon']) for p in e['geometry']], np.int32)
    cv2.polylines(ref, [pts], False, (0, 230, 255), 2, cv2.LINE_AA)

MAP = cv2.imread('/home/dpu/aiden/snowhere/atlas/zao.jpg')
MH, MW = MAP.shape[:2]

boot_map = np.array([
    [1230, 415],
    [1005, 415],
    [870, 1230],
    [1560, 1050],
], np.float64)
boot_gps = np.array([
    [38.1277, 140.4482],
    [38.1590, 140.4150],
    [38.1570, 140.4335],
    [38.1200, 140.4800],
], np.float64)
boot_ref = np.array([proj(*g) for g in boot_gps])

H0, _ = cv2.findHomography(boot_ref, boot_map)
print('bootstrap H0 ok')

gray_map = cv2.cvtColor(MAP, cv2.COLOR_BGR2GRAY)
sift = cv2.SIFT_create(nfeatures=6000)
kp_m, de_m = sift.detectAndCompute(gray_map, None)
print('map keypoints:', len(kp_m))

bf = cv2.BFMatcher()
all_pairs = []
H = H0
for it in range(3):
    warped = cv2.warpPerspective(ref, H, (MW, MH))
    gray_w = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    kp_w, de_w = sift.detectAndCompute(gray_w, None)
    matches = bf.knnMatch(de_w, de_m, k=2)
    good = [m for m, n in (mm for mm in matches if len(mm) == 2) if m.distance < 0.75 * n.distance]
    print(f'iter {it}: warped kp {len(kp_w)}, good matches {len(good)}')
    if len(good) < 8: break
    src = np.float32([kp_w[m.queryIdx].pt for m in good])
    dst = np.float32([kp_m[m.trainIdx].pt for m in good])
    Hm, mask = cv2.findHomography(src, dst, cv2.RANSAC, 12.0)
    inliers = int(mask.sum())
    print(f'  RANSAC inliers: {inliers}/{len(good)}')
    H = Hm @ H
    for i, m in enumerate(good):
        if mask[i]:
            all_pairs.append((src[i], dst[i]))
    if inliers < 10: break

pairs = np.array(all_pairs)
print('total inlier pairs:', len(pairs))

ref_pts = pairs[:, 0]
gps = np.array([unproj(x, y) for x, y in ref_pts])
map_pts = pairs[:, 1]

def poly_cols(pts, order):
    cols = [np.ones(len(pts))]
    for o in range(1, order + 1):
        for i in range(o + 1):
            cols.append(pts[:, 0] ** (o - i) * pts[:, 1] ** i)
    return np.column_stack(cols)

best = None
for order in (2, 3):
    A = poly_cols(gps, order)
    cx, *_ = np.linalg.lstsq(A, map_pts[:, 0], rcond=None)
    cy, *_ = np.linalg.lstsq(A, map_pts[:, 1], rcond=None)
    rep = np.column_stack([A @ cx, A @ cy])
    err = np.linalg.norm(rep - map_pts, axis=1)
    print(f'poly{order}: mean {err.mean():.1f}px  median {np.median(err):.1f}px  p90 {np.percentile(err, 90):.1f}px')
    if best is None or err.mean() < best[1]:
        best = (order, err.mean(), cx, cy)

order, meanerr, cx, cy = best
calib = {'image': 'zao.jpg', 'mode': f'poly{order}',
         'model': [f'poly{order}', cx.tolist(), cy.tolist()],
         'pairs': len(pairs), 'mean_px': round(float(meanerr), 1)}
json.dump(calib, open('/home/dpu/aiden/snowhere/atlas/zao.calib.json', 'w'), indent=1)
print('saved zao.calib.json')

vis = MAP.copy()
for (mx, my), e in zip(map_pts, err):
    c = (0, 255, 0) if e < 40 else (0, 200, 255) if e < 90 else (0, 80, 255)
    cv2.circle(vis, (int(mx), int(my)), 5, c, -1)
cv2.imwrite('/tmp/opencode/zao-matches.png')
thumb = vis.copy(); thumb.thumbnail((1500, 1500))
cv2.imwrite('/tmp/opencode/zao-validate.png')
print('validation saved')
