const OVERPASS = 'https://overpass-api.de/api/interpreter';

const ZH_NAMES = {
  'Niseko United': '新雪谷聯合', 'Grand Hirafu': '新雪谷 Grand Hirafu', 'Niseko Annupuri': '新雪谷 Annupuri',
  'Niseko Village': '新雪谷 Village', 'Hanazono': '花園雪場', 'Rusutsu': '留壽都', 'Kiroro': '喜樂樂',
  'Furano': '富良野', 'Tomamu': '星野 TOMAMU', 'Sahoro': '佐幌', 'Teine': '手稻', 'Sapporo Teine': '札幌手稻',
  'Sapporo Kokusai': '札幌國際', 'Noboribetsu': '登別', 'Lake Toya': '洞爺湖', 'Asahidake': '旭岳',
  'Kamui Ski Links': '神居滑雪場', 'Mount Racey': '雷西', 'Hakuba Goryu': '白馬五龍', 'Hakuba47': '白馬47',
  'Happo-One': '八方尾根', 'Tsugaike Kogen': '栂池高原', 'Iwatake': '岩岳', 'Hakuba Norikura': '白馬乘鞍',
  'Hakuba Cortina': '白馬栂池/科爾蒂納', 'Kashimayari': '鹿島槍', 'Goryu': '五龍', 'Shiga Kogen': '志賀高原',
  'Nozawa Onsen': '野澤溫泉', 'Myoko Suginohara': '妙高杉之原', 'Akakura': '赤倉', 'Ikenotaira': '池之平',
  'GALA Yuzawa': 'GALA 湯澤', 'Naeba': '苗場', 'Kagura': '神樂', 'Yuzawa Kogen': '湯澤高原',
  'Zao Onsen': '藏王溫泉', 'Appi Kogen': '安比高原', 'Geto Kogen': '夏油高原', 'Hachimantai': '八幡平',
  'Nekoma': '貓魔', 'Alts Bandai': '裏磐梯 ALTs', 'Grandeco': 'Grandeco', 'Inawashiro': '豬苗代',
  'Karuizawa': '輕井澤', 'Togakushi': '戶隱', 'Iizuna': '飯綱', 'Ryuoo': '龍王', 'Shiga': '志賀',
  'Okushiga': '奧志賀', 'Yokote': '橫手', 'Ichinose': '一之瀨', 'Terakoya': '寺子屋',
  'Kandatsu': '神立', 'Ishuchi': '', 'Marunuma': '丸沼高原', 'White World Oze': '尾瀨岩鞍',
  'Tanigawadake': '谷川岳', 'Hodaigi': '武尊', 'Kai Kawaguchiko': '河口湖', 'Fujiten': '富士天',
  'Yamagata Zao': '山形藏王', 'Sapporo Bankei': '盤溪', 'Snow Cruise Onze': 'ONZE', 'Aizu': '會津',
  'Takasu': '高鷲', 'Dynaland': 'Dynaland', 'Hirugano': '蛭野', 'Meiho': '明寶', 'White Pia': 'White Pia',
  'Charmant Hiuchi': '妙高 Charmant', 'Tazawako': '田澤湖', 'Shizukuishi': '雫石', 'Hachimantai Appi': '安比',
  'Makuiwa': '', 'Sun Meadows': '太陽牧場', 'Kusatsu': '草津', 'Manza': '萬座', 'Palcall': 'Palcall 草津',
  'Oze Iwakura': '尾瀨岩鞍', 'Hunter Mountain': '獵人山', 'Minakami': '水上', 'Okutone': '奧利根',
};

const zhFor = (tags) => {
  if (tags['name:zh']) return tags['name:zh'];
  const en = tags['name:en'] || '';
  for (const [k, v] of Object.entries(ZH_NAMES)) {
    if (en.includes(k) || (tags.name || '').includes(k)) return v;
  }
  return '';
};

const R_EARTH = 6371000;
const hav = (a, b) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
};

async function run() {
  const q = `[out:json][timeout:180];
area["ISO3166-1"="JP"][admin_level=2]->.jp;
(
  way["landuse"="winter_sport"](area.jp);
  relation["landuse"="winter_sport"](area.jp);
);
out tags bb;`;
  console.log('querying overpass...');
  const res = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q) });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const json = await res.json();

  const resorts = [];
  for (const el of json.elements) {
    const b = el.bounds;
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'] || tags['name:ja'];
    if (!b || !name) continue;
    const lat = (b.minlat + b.maxlat) / 2;
    const lng = (b.minlng + b.maxlng) / 2;
    const diag = hav({ lat: b.minlat, lng: b.minlng }, { lat: b.maxlat, lng: b.maxlng });
    const r = diag / 2;
    if (r < 400 || r > 16000) continue;
    resorts.push({
      name,
      en: tags['name:en'] || '',
      zh: zhFor(tags),
      lat: +lat.toFixed(5),
      lng: +lng.toFixed(5),
      r: Math.round(r),
    });
  }

  const seen = new Set();
  const dedup = [];
  for (const s of resorts.sort((a, b) => b.r - a.r)) {
    const key = `${s.name}@${s.lat.toFixed(2)},${s.lng.toFixed(2)}`;
    const dup = dedup.find((d) => hav(d, s) < Math.max(d.r, s.r) * 0.8);
    if (dup || seen.has(key)) continue;
    seen.add(key);
    dedup.push(s);
  }

  dedup.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  fs.writeFileSync(new URL('../data/resorts.json', import.meta.url), JSON.stringify(dedup));
  console.log(`resorts: ${dedup.length}`);
  const named = dedup.filter((s) => s.zh).length;
  console.log(`with zh names: ${named}`);
  for (const s of dedup.slice(0, 8)) console.log(' ', s.zh || s.en || s.name, s.lat, s.lng, s.r);
}

import fs from 'fs';
run().catch((e) => { console.error(e); process.exit(1); });
