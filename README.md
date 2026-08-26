# 雪裡 SNOWHERE ❄️

**https://snow.smarternic.com**

在日本滑雪時找不到自己在雪場哪裡？打開這一頁：GPS 抓你的位置，
判定你在哪個雪場，把你精準疊在真實地圖的雪道上——真實比例尺、誤差圈、海拔速度。

## 官方地圖模式 🎿

把你的 GPS 位置直接疊在**雪場官方地圖**上（內建 10 張：新雪谷 Grand Hirafu／Niseko United、留壽都、Kiroro、手稻、札幌國際、藏王、安比、貓魔南北）。

- 每張地圖已**預先校準**：以 OSM 纜車站端點、山峰、命名設施的真實座標為控制點，多項式擬合自動對位——你什麼都不用做，打開就定位
- Hirafu 校準殘差約 33m；3D 手繪圖因繪製特性整體誤差約 50–300m，公尺級精確定位請切「精準地圖」分頁
- 官方地圖版權屬各雪場，本站僅作個人導航用途

## 功能

- 📍 GPS 定位（高精度模式，戶外誤差約 3–10 m，顯示誤差圈）
- 🏔️ 自動判定你所在的雪場（內建 212 個日本雪場偵測區，源自 OSM 雪道資料聚類）
- 🗺️ 三種底圖：OSM 標準（含雪道描繪）、衛星（Esri）、地形圖（OpenTopoMap）
- 🎿 滑行軌跡記錄：畫出你滑過的路線與總距離（只存在你的瀏覽器）
- ⛰️ 即時海拔與速度
- 🔍 雪場搜尋——不在山上也能先研究雪場地圖

## 資料與授權

- 雪道與雪場範圍：© OpenStreetMap 貢獻者（ODbL）——由 5,377 條 `piste:type=downhill` 雪道聚類成 212 個雪場偵測區
- 底圖：© OpenStreetMap 貢獻者 ／ Esri World Imagery ／ © OpenTopoMap (CC-BY-SA)
- 官方手繪雪場圖有版權且無地理座標，無法精準疊合 GPS——本站因此選擇開源、可精準定位的真實地圖

## 技術

- Leaflet 1.9.4（已 vendor，無 CDN 依賴）
- 純靜態、無後端、無追蹤；軌跡只存在瀏覽器 localStorage
- 部署：Vercel + Cloudflare DNS

---

smarternic.com 系列作品：
[SmarterNIC Hub](https://smarternic.com) ·
[線速 Wire Speed](https://wire.smarternic.com) ·
[網卡解剖 NIC ANATOMY](https://nic.smarternic.com) ·
[鏡地 Terra Mirror](https://terra.smarternic.com) ·
[新竹此刻](https://hsinchu.smarternic.com) ·
[發票對獎](https://invoice.smarternic.com) ·
[瞬鏈 SnapLink](https://snaplink.smarternic.com)
