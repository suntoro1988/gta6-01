# Sunset Bay

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Game open-world ala GTA di browser, dibuat untuk bounty **gta6-01** di
[make.fun](https://make.fun/bounty/gta6-01). Kamu bebas menjelajah kota
tepi pantai saat golden hour: mencuri mobil, kabur dari polisi, balapan
jalanan, merekrut crew, membeli bisnis, dan menyelesaikan heist.

## Cara main

Buka `game/index.html` di browser, atau jalankan server lokal:

```sh
node --experimental-strip-types serve.ts
# lalu buka http://localhost:8080/
```

## Kontrol

| Tombol | Aksi |
| ------ | ---- |
| W / A / S / D | Jalan / mengemudi |
| Spasi | Rem tangan / lompat |
| E | Masuk / keluar kendaraan |
| F | Tembak |
| R | Ganti senjata |
| M | Radio (6 stasiun) |
| P / Esc | Pause |
| C | Lanjutkan (save/load) |

## Fitur utama

- **Kota hidup**: 12+ distrik, 250+ gedung, pelabuhan, pantai ramai,
  36+ mobil traffic, 24+ pejalan kaki, 5+ perahu.
- **20+ misi / 60+ stage**, termasuk heist 3 fase *"The Harbour Lights Job"*.
- **Wanted 0–5 bintang + Heat 0–100**: heli polisi AIR-1, roadblock, PIT.
- **Crew**: rekrut 4 anggota dengan perintah dan ability masing-masing.
- **Ekonomi**: beli bisnis (pemasukan pasif), properti, dan upgrade garasi.
- **Balapan jalanan**: 5+ balapan dengan checkpoint dan hadiah uang.
- **Cuaca lokal**: hujan di satu area, cerah di area lain, genangan,
  pelangi, angin, siklus siang-malam, golden hour 18:20.
- **4 senjata** (pistol / SMG / shotgun / rifle), `buyAmmo` $50 untuk +24.
- **Respect ranks**: Rookie → Street → Boss → Kingpin.
- **6 stasiun radio original**, save/load via localStorage, minimap, HUD.
- **Momen ikonik**: kejar-kejaran helikopter saat sunset di atas jembatan
  dan air — hero shot sekaligus misi.

## Struktur repo

```text
game/            Kode game (index.html + src/*.js, namespace window.SB)
screenshots/      4 screenshot kompetisi (1280x719)
main.ts          Build: salin game/ + screenshots/ ke output, tulis dossier.json
serve.ts         Server statis lokal untuk testing
shots.json       Metadata 4 screenshot
vendor/          Kit make.fun (jangan diubah)
```

## Screenshot

1. `1-start.jpg` — layar start, kota golden hour, pantai ramai.
2. `2-play.jpg` — kejar-kejaran mobil, heli AIR-1, wanted 3 bintang.
3. `3-foot.jpg` — jalan kaki di jalan pantai saat sunset.
4. `4-end.jpg` — heli AIR-1, spotlight, wanted 4 bintang, ledakan.

## Build

```sh
node --experimental-strip-types main.ts
# Menyalin game/ + screenshots/ ke ./output dan menulis dossier.json
```

Build memakai Node 22 stdlib saja, tanpa dependensi eksternal.

## Lisensi

MIT — lihat [LICENSE](LICENSE).
