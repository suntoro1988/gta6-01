# Sunset Bay

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![make.fun · gta6-01 rank](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![make.fun · gta6-01 reward](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Sunset Bay adalah game open-world 3D yang berjalan sepenuhnya di browser — tanpa instalasi, tanpa server, tanpa koneksi internet. Jelajahi kota pesisir dengan 10 distrik, dari Downtown yang padat sampai Marina Bay dan Hillcrest di tepi laut. Curi mobil, antar penumpang taksi, selesaikan 18 misi dalam 49 stage, kabur dari kejaran polisi dan helikopter, lalu bersantai di speedboat saat matahari terbenam.

Game ini dibangun dengan WebGL mentah (tanpa engine dan tanpa dependensi eksternal). Kota dibuat prosedural dengan seed deterministik, jadi tata kotanya identik setiap kali dimuat. Ada siklus siang-malam, radio dengan 5 stasiun musik synth, sistem wanted 0–5 bintang, garasi untuk upgrade dan respray, safehouse, dan penyimpanan otomatis di browser.

## Cara main

1. Jalankan server lokal: `npx tsx serve.ts` (atau sajikan folder `game/` dengan server statis apa pun), lalu buka `http://localhost:8080`.
2. Di layar judul pilih **New Game** untuk mulai dari awal, atau **Continue** untuk melanjutkan simpanan terakhir.
3. Ikuti penanda misi di peta dan minimap. Selesaikan stage demi stage untuk membuka misi berikutnya dan mendapat hadiah uang.
4. Uang dipakai untuk upgrade mesin di garasi, beli amunisi dan armour, atau respray mobil untuk menghapus level wanted.
5. Progres tersimpan otomatis di browser (localStorage), jadi kamu bisa lanjut kapan saja.

## Kontrol

| Tombol | Aksi |
| --- | --- |
| W / A / S / D | Jalan / mengemudi (A/D belok saat di mobil) |
| Shift | Lari |
| E | Curi / masuk mobil terdekat, naik-turun speedboat di dermaga |
| F | Pukul / tembak (saat bersenjata), respray di garasi |
| Spasi | Drift saat mengemudi |
| Klik mouse | Tembak (saat bersenjata) |
| 1–4 | Ganti slot senjata |
| M | Ganti stasiun radio |
| Tab | Peta fullscreen (POI, daftar misi, statistik) |
| P | Pause / lanjut |
| Esc | Tutup peta / pause |

## Fitur

- 18 misi / 49 stage di 10 distrik bernama
- Speedboat yang bisa dikendarai di laut barat dan selatan kota
- Job taksi dan antar paket
- Lalu lintas AI, pejalan kaki, polisi dengan HP, dan helikopter AIR-1 di wanted 3+
- Sistem wanted 0–5, busted dan wasted dengan respawn di safehouse
- Garasi dan toko: upgrade mesin, respray $150, amunisi, armour
- Radio 5 stasiun (BAY FM, SUNSET DRIVE, PALM COURT, NIGHT WAVE, TIDE FM)
- Siklus siang-malam dan efek kabut
- Peta fullscreen + minimap
- Save otomatis + Continue
- Sepenuhnya offline, tanpa request eksternal

## Teknologi

- WebGL mentah, JavaScript biasa (bukan ES module), tanpa dependensi
- Kota prosedural deterministik (seed 7)
- WebAudio synth untuk SFX dan musik radio
- Node 22 stdlib saja untuk tooling (`main.ts`, `serve.ts`)

## Lisensi

Lihat file `LICENSE`.
