import json, sys
import numpy as np
from PIL import Image, ImageDraw

def polyfit_model(src, dst, order=2):
    src = np.array(src, float); dst = np.array(dst, float)
    cols = [np.ones(len(src))]
    for o in range(1, order + 1):
        for i in range(o + 1):
            cols.append(src[:, 0] ** (o - i) * src[:, 1] ** i)
    A = np.column_stack(cols)
    cx, *_ = np.linalg.lstsq(A, dst[:, 0], rcond=None)
    cy, *_ = np.linalg.lstsq(A, dst[:, 1], rcond=None)
    return ('poly' + str(order), cols, cx, cy)

def poly_cols(pts, order):
    pts = np.array(pts, float)
    cols = [np.ones(len(pts))]
    for o in range(1, order + 1):
        for i in range(o + 1):
            cols.append(pts[:, 0] ** (o - i) * pts[:, 1] ** i)
    return np.column_stack(cols)

def apply_model(M, pts):
    if M[0].startswith('poly'):
        order = int(M[0][4:])
        A = poly_cols(pts, order)
        return np.column_stack([A @ M[2], A @ M[3]])
    return apply_h(M, pts)

def homography(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y, v])
    A = np.array(A)
    _, _, Vt = np.linalg.svd(A)
    H = Vt[-1].reshape(3, 3)
    return H / H[2, 2]

def apply_h(H, pts):
    pts = np.hstack([pts, np.ones((len(pts), 1))])
    proj = pts @ H.T
    return proj[:, :2] / proj[:, 2:3]

def main(cfg_path):
    cfg = json.load(open(cfg_path))
    mode = cfg.get('mode', 'poly3')
    if mode.startswith('poly'):
        M = polyfit_model(cfg['gps'], cfg['px'], int(mode[4:]))
        reproj = apply_model(M, cfg['gps'])
    else:
        M = homography(np.array(cfg['gps'], float), np.array(cfg['px'], float))
        reproj = apply_h(M, np.array(cfg['gps'], float))

    errs = np.linalg.norm(reproj - np.array(cfg['px'], float), axis=1)
    for i, (p, e) in enumerate(zip(cfg['points'], errs)):
        print(f"  {p['label']:<30} residual {e:7.1f}px")
    print(f"  mean residual: {errs.mean():.1f}px")

    out = {'image': cfg['image'], 'mode': mode,
           'anchors': [{'label': p['label'], 'gps': g, 'px': px}
                       for p, g, px in zip(cfg['points'], cfg['gps'], cfg['px'])]}
    out['model'] = [M[0], np.asarray(M[2]).tolist(), np.asarray(M[3]).tolist()] if M[0].startswith('poly') else np.asarray(M).tolist()
    json.dump(out, open(cfg['out'], 'w'), ensure_ascii=False, indent=1)
    print('saved', cfg['out'])

    if 'validate' in cfg and cfg['validate']:
        im = Image.open(cfg['image']).convert('RGB')
        d = ImageDraw.Draw(im)
        for v in cfg['validate']:
            px = apply_model(M, [v['gps']])[0]
            x, y = int(px[0]), int(px[1])
            d.line([(x - 30, y), (x + 30, y)], fill=(255, 40, 40), width=5)
            d.line([(x, y - 30), (x, y + 30)], fill=(255, 40, 40), width=5)
            d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 255, 0), width=3)
            d.text((x + 34, y - 8), v['label'], fill=(255, 255, 0))
            print(f"  validate {v['label']:<24} -> px ({x}, {y})")
        thumb = im.copy(); thumb.thumbnail((1600, 1600))
        thumb.save(cfg['validate_out'])
        print('validation overlay:', cfg['validate_out'])

if __name__ == '__main__':
    main(sys.argv[1])
