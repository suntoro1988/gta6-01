# Sunset Bay — GTA 6 open-world di browser

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Sunset Bay** adalah game open-world 3D bergaya GTA yang berjalan langsung di
browser — tanpa instalasi, tanpa server. Kamu bebas menjelajahi kota pantai
Sunset Bay: berkendara di jalanan kota, berjalan kaki di distrik marina,
menerima misi, menghindari (atau memancing) kejaran polisi, sampai menerbangkan
helikopter di atas teluk saat matahari terbenam.

Dibangun untuk bounty [make.fun gta6-01](https://make.fun/bounty/gta6-01):
buat game open-world ala GTA 6 yang bisa dimainkan di browser.

## Yang ada di dalam game

- **Kota pantai 3D** — pusat kota, jembatan teluk, distrik marina, dan jalanan
  yang hidup dengan lalu lintas dan pejalan kaki.
- **18 misi** — dari antar paket sampai kejar-kejaran; setiap misi punya
  tujuan, hadiah, dan tingkat kesulitan sendiri.
- **5 stasiun radio** — musik dan obrolan yang berbeda-beda, bisa diganti
  kapan saja saat berkendara.
- **Helikopter** — rebut dan terbangkan helikopter untuk melihat kota dari
  atas teluk.
- **Sistem wanted 0–5 bintang** — makin besar kekacauan yang kamu buat, makin
  agresif polisi mengejarmu. Sembunyi atau kabur sampai bintangmu turun.
- **Siklus siang–malam** — kota berubah dari pagi yang cerah sampai senja
  keemasan dan malam berneon.

## Cara main

Buka `game/index.html` di browser desktop, atau jalankan server lokal:

```sh
node serve.ts
```

lalu buka <http://localhost:8080/game/> di browser.

Tidak perlu build, tidak perlu install apa pun — game ini file statis murni
(HTML, JavaScript, dan CSS) dan berjalan offline setelah dimuat.

## Kontrol

| Tombol | Aksi |
| --- | --- |
| `W` / `A` / `S` / `D` | Bergerak / mengemudi (maju, kiri, mundur, kanan) |
| `Shift` | Lari / ngebut |
| `Spasi` | Rem / lompat |
| `E` | Masuk / keluar kendaraan |
| `F` | Masuk helikopter |
| `R` | Ganti stasiun radio |
| `M` | Buka peta |
| `Esc` / `P` | Jeda |
| Mouse | Putar kamera |

## Struktur repo

```text
game/            game yang bisa dimainkan (index.html + src/)
screenshots/     4 tangkapan layar game (cover + 3 adegan)
vendor/          pustaka make.fun (buildDossier) — jangan diubah
main.ts          entry point: menyalin game + screenshot ke /output
                 lalu menulis dossier.json lewat buildDossier
serve.ts         server statis kecil untuk QA lokal di port 8080
shots.json       manifest screenshot
```

## Lisensi

MIT — lihat [LICENSE](LICENSE).
