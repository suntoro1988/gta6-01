# Sunset Bay — Open-World Crime Game

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Sunset Bay** is a fictional sunny coastal city you can explore on foot or
behind the wheel, right in your browser — no install, no network, no account
needed. Steal cars, outrun the police, run jobs across 10 districts, chase
the sunset, and work your way from ROOKIE to KINGPIN.

## How to play

Open `game/index.html` in a desktop browser (or run the local server below)
and hit **START ENGINE**.

### Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Walk / drive |
| Shift | Sprint on foot |
| Space | Handbrake (drift in a car) |
| E | Steal a nearby car or speedboat |
| F | Punch (on foot) |
| Mouse click | Shoot (when armed) |
| 1–4 | Switch weapon: fists, pistol, SMG, shotgun |
| M | Change radio station |
| N | Mute / unmute sound |
| Tab | Full-screen city map |
| P / Esc | Pause |
| Enter | Start from the title screen |

### The city

Sunset Bay has **10 districts** — Downtown, Old Town, Southside, Hillcrest,
Beachfront, The Pier, Sunset Mall, Marina Bay, Northside and Uptown — each
with its own look. Drive the boardwalk at Beachfront, watch the sun drop
from the Hillcrest lookout, or take a speedboat out from Marina Bay.

### Missions — 18 chained jobs

Work through 18 missions, from **First Wheels** ($100) to the finale
**Sunset Heist** ($1,500): package runs, street races, getaways, a bank job,
a midnight courier run, and a boat escape at sunset. Finish fast and you
earn a **+50% fast bonus**. Between jobs, pick up taxi fares ($40–$120),
find 6 hidden stash packs (+$100 each), and drift for cash (+$50 per drift).

### Wanted level

Causing trouble raises your heat. At 5 stars the police helicopter AIR-1
joins the chase. You are only busted if a cop gets within 5 units while you
are moving slower than a walk for 4.5 seconds — so keep running. Lose the
heat with a respray at the Sunset Garage.

### Money, REP and upgrades

Earn cash from missions, taxis, stashes and drifts. Spend it at the
**Sunset Garage** (engine upgrades, respray), the **Shop** (ammo and armor),
and rest up at the **Safehouse**. Your REP climbs from ROOKIE to HUSTLER to
KINGPIN as you complete jobs.

### Radio — 5 stations

BAY FM, SUNSET DRIVE, NEON NIGHTS, PALM COURT and TIDE FM. All music is
synthesized live in your browser with WebAudio — no audio files, no
streaming.

### Saving

Progress saves automatically to your browser (localStorage) — money,
missions, stash, upgrades, REP, position and time of day. Use **CONTINUE**
on the title screen to pick up where you left off.

### Day–night cycle

The game clock starts at 18:00, dusk. Light shifts from golden sunset to
purple night as street lamps and neon switch on.

## Run locally

```sh
# Node 22, no dependencies
node serve.ts            # http://localhost:8080/
node serve.ts 9000       # or any port you like
```

URL tricks for testing and screenshots:

- `?seed=7` — deterministic world (same traffic, peds and layout)
- `?shot=play&seed=7` — jump straight into a staged scene
  (scenes: `start`, `play`, `foot`, `end`)

## Build / package

```sh
MAKEFUN_OUTPUT_DIR=/output node main.ts
```

This copies `game/` and `screenshots/` into the output directory and
writes `dossier.json` there.

## Tech

- Raw WebGL + DOM + WebAudio. No external libraries, no network requests.
- Pure ES modules, no build step.
- Procedural city, cars, pedestrians and music — everything is generated
  in code from a seed.

## Credits

Sunset Bay is a fictional city and an original game made for the make.fun
bounty. No real brands, places or people are depicted. Built with plain
JavaScript, WebGL and WebAudio.
