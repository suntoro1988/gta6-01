# Sunset Bay v12

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Sunset Bay** adalah game open-world ala GTA yang berjalan penuh di
browser — tanpa install, tanpa server, tanpa build step. Jelajahi kota
pantai saat golden hour, kerjakan misi, balapan di jalanan, bangun
bisnis, dan kabur dari kejaran helikopter polisi di bawah langit sunset.

## Fitur utama

- **20+ misi** dalam **60+ stage**, termasuk heist 3 fase "The Harbour Lights Job".
- **3 misi showcase** — heist pelabuhan, balapan pantai, dan penyelamatan crew.
- **6 stasiun radio** original dengan musik diegetik dan DJ khas tiap stasiun.
- **5+ balapan jalanan** dengan checkpoint, lawan AI, dan hadiah uang tunai.
- **12+ distrik** dengan reputasi 0–100 yang memengaruhi harga dan reaksi NPC.
- **250+ gedung**, pelabuhan, pantai ramai, jalan raya, dan 3 interior.
- **36+ mobil** traffic dan **5+ perahu** di teluk.
- **24+ pejalan kaki** — turis pantai, NPC selfie, sampai hewan peliharaan.
- **4 senjata** (pistol, SMG, shotgun, rifle) dengan isi ulang $50 / +24 peluru.
- **4 anggota crew** yang bisa direkrut, diperintah, dan punya ability sendiri.
- **5 bintang wanted** + Heat 0–100, heli AIR-1, roadblock, dan manuver PIT.
- **3 bisnis** untuk pemasukan pasif, properti/safehouse, dan garasi upgrade.
- **4 peringkat respect**: Rookie → Street → Boss → Kingpin.
- Cuaca lokal (hujan di satu area, cerah di area lain), genangan, pelangi.
- Siklus siang–malam, golden hour default 18:20, neon malam, save/load.

## Momen ikonik

Kejar-kejaran helikopter saat sunset di atas jembatan dan perairan teluk —
AIR-1 menyapu jalan dengan spotlight sementara kamu melaju di bawahnya.

## Cara main

- **W A S D** — jalan / mengemudi, **Spasi** — rem tangan, **E** — masuk/keluar mobil.
- **Mouse** — arahkan kamera, **Klik kiri** — tembak, **1–4** — ganti senjata.
- **R** — isi peluru ($50), **M** — ganti stasiun radio, **P** — pause.
- **Tab** — minimap + rute misi. Misi pertama memberi +$200 dan REP +100.
- Progress tersimpan otomatis (Continue) lewat localStorage.

## Menjalankan lokal

```sh
node serve.ts
# buka http://127.0.0.1:8080
```

## Membangun entry

```sh
node main.ts
# menyalin game/ + screenshots/ ke /output dan menulis dossier.json
```

## Struktur repo

- `game/` — game lengkap (WebGL murni, tanpa library eksternal).
- `game/src/` — modul `window.SB`: kota, kendaraan, polisi, misi, cuaca, FX, audio, HUD.
- `screenshots/` — 4 render 1280×719 (≤256 KiB tiap file).
- `main.ts` — builder entry (Node 22, stdlib saja).
- `serve.ts` — server dev statis di port 8080.
- `shots.json` — konfigurasi 4 screenshot.
- `vendor/makefun-game.ts` — library dossier resmi make.fun (jangan diubah).

## Tips

- Selesaikan misi 1 dulu: +$200 dan REP +100 membuka misi berikutnya.
- Naikkan reputasi distrik sebelum belanja — harga turun, NPC lebih ramah.
- Beli bisnis pertama secepat mungkin: pemasukan pasif mendanai balapan.
- Simpan amunisi untuk heist; isi ulang selalu $50 per 24 peluru.

## Lisensi

MIT — lihat `LICENSE`.
