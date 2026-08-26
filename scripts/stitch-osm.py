import math, io, sys, urllib.request
from PIL import Image, ImageDraw

def tilexy(lat, lng, z):
    n = 2 ** z
    x = (lng + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y

def stitch(lat1, lng1, lat2, lng2, z, out, grid_step=0.01):
    xs, ys = [], []
    for lat, lng in [(lat1, lng1), (lat2, lng2)]:
        x, y = tilexy(lat, lng, z)
        xs += [int(x), int(x) + 1]
        ys += [int(y), int(y) + 1]
    txlo, txhi, tylo, tyhi = min(xs), max(xs), min(ys), max(ys)
    W, H = (txhi - txlo + 1) * 256, (tyhi - tylo + 1) * 256
    canvas = Image.new('RGB', (W, H), (20, 20, 20))
    for tx in range(txlo, txhi + 1):
        for ty in range(tylo, tyhi + 1):
            url = f'https://tile.openstreetmap.org/{z}/{tx}/{ty}.png'
            req = urllib.request.Request(url, headers={'User-Agent': 'snowhere-calib/1.0'})
            with urllib.request.urlopen(req, timeout=25) as r:
                tile = Image.open(io.BytesIO(r.read())).convert('RGB')
            canvas.paste(tile, ((tx - txlo) * 256, (ty - tylo) * 256))
    d = ImageDraw.Draw(canvas)
    lat = min(lat1, lat2)
    while lat <= max(lat1, lat2) + 1e-9:
        py = (tilexy(lat, lng1, z)[1] - tylo) * 256
        if 0 <= py < H:
            d.line([(0, py), (W, py)], fill=(255, 60, 60), width=2)
            d.text((4, py + 2), f'{lat:.3f}', fill=(255, 200, 60))
        lat += grid_step
    lng = min(lng1, lng2)
    while lng <= max(lng1, lng2) + 1e-9:
        px = (tilexy((lat1 + lat2) / 2, lng, z)[0] - txlo) * 256
        if 0 <= px < W:
            d.line([(px, 0), (px, H)], fill=(60, 100, 255), width=2)
            for yy in range(4, H - 40, 260):
                d.text((px + 3, yy), f'{lng:.3f}', fill=(150, 190, 255))
        lng += grid_step
    canvas.save(out)
    print(out, canvas.size)

if __name__ == '__main__':
    stitch(float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]),
           int(sys.argv[5]), sys.argv[6], float(sys.argv[7]) if len(sys.argv) > 7 else 0.01)
