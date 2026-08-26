import json
import numpy as np

gps = np.array([[38.1277, 140.4482], [38.1439, 140.4398], [38.1520, 140.4320], [38.1570, 140.4335]])
px = np.array([[1881, 621], [1575, 578], [1404, 793], [1168, 1886]])
A = np.column_stack([gps, np.ones(4)])
cx, *_ = np.linalg.lstsq(A, px[:, 0], rcond=None)
cy, *_ = np.linalg.lstsq(A, px[:, 1], rcond=None)
rep = np.column_stack([A @ cx, A @ cy])
err = np.linalg.norm(rep - px, axis=1)
print('zao affine residuals:', err.round(1), 'mean', round(err.mean(), 1))

p = 'manifest.json'
m = json.load(open(p))
for item in m:
    if item['id'] == 'zao':
        item['seed'] = {'mode': 'affine', 'cx': cx.tolist(), 'cy': cy.tolist()}
json.dump(m, open(p, 'w'), ensure_ascii=False, indent=1)
print('manifest updated')

s = open('/home/dpu/aiden/snowhere/js/official.js').read()
old = """    if (m.seed && m.seed.mode === 'auto') {
      anchors = m.seed.anchors;
      calib = fitModel(anchors);
    } else if (m.seed) {"""
new = """    if (m.seed && m.seed.mode === 'auto') {
      anchors = m.seed.anchors;
      calib = fitModel(anchors);
    } else if (m.seed && m.seed.mode === 'affine') {
      anchors = [];
      calib = { mode: 'affine', cx: m.seed.cx, cy: m.seed.cy };
    } else if (m.seed) {"""
assert old in s, 'pattern missing'
s = s.replace(old, new)
old2 = """    if (calib.mode === 'sim') {"""
new2 = """    if (calib.mode === 'affine') {
      return [calib.cx[0] + calib.cx[1] * lat + calib.cx[2] * lng,
              calib.cy[0] + calib.cy[1] * lat + calib.cy[2] * lng];
    }
    if (calib.mode === 'sim') {"""
assert old2 in s, 'pattern2 missing'
s = s.replace(old2, new2)
open('/home/dpu/aiden/snowhere/js/official.js', 'w').write(s)
print('official.js affine support added')
