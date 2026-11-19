# Sunset Bay — Open-World Crime Game

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An open-world crime game set in the fictional coastal city of **Sunset Bay**.
Drive, walk, dodge the heat, and work your way up across **10 districts** and
**18 missions** — from your first joyride in Marina Bay to owning the whole bay.

## Features

- **Open world** — 10 hand-built districts: Marina Bay, Old Town, Hillcrest,
  Portside, Little Havana, Coral Keys, North Beach, Downtown, Sunset Strip,
  and the Airport. Day/night cycle with a real sunset over the water.
- **18 missions** — multi-stage jobs with objectives, progress tracking, and
  cash payouts. Missions unlock in order; progress is saved automatically.
- **Driving & on-foot play** — steal any car, handbrake turns, traffic,
  pedestrians, and pay 'n' spray shops to repair your ride and lose the cops.
- **Wanted system** — 5-star heat. The higher the heat, the more patrol cars
  hunt you. Lay low or spray your car to cool off.
- **Radio** — 5 stations built with WebAudio: TIDE FM, SUNSET ROCK,
  BAY TALK, NEON NIGHTS, and CLASSIC COAST. Press R to switch.
- **Save system** — money, missions, and unlocks persist in `localStorage`.
- **Deterministic mode** — `?seed=7` makes traffic, pedestrians, and spawns
  reproducible. `?shot=start|play|foot|end` jumps straight to a scene.

## Controls

| Key | Action |
| --- | ------ |
| W A S D | Drive / walk — gas, steer, brake, reverse |
| E | Enter / exit a car (stand close to one) |
| Space | Handbrake — sharp turns, drifting |
| M | Open / close the city map |
| R | Switch radio station |
| F | Pay 'n' spray — repair car, lose the cops ($150) |
| P / Esc | Pause |

## Run locally

```sh
node serve.ts        # serves the repo on http://localhost:8080/
```

Then open `http://localhost:8080/` in a browser. No install step, no
dependencies, no network — the game runs fully offline.

Useful URLs:

- `http://localhost:8080/?seed=7` — deterministic world (seed 7)
- `http://localhost:8080/?shot=start` — title screen scene
- `http://localhost:8080/?shot=play` — driving scene
- `http://localhost:8080/?shot=foot` — on-foot scene
- `http://localhost:8080/?shot=end` — mission-complete scene

## Build the entry dossier

```sh
MAKEFUN_OUTPUT_DIR=/output node main.ts
```

This copies `game/` and `screenshots/` into the output directory and writes
`dossier.json` (built with the kit in `vendor/makefun-game.ts`).

## Tech

- Raw **WebGL** rendering + DOM HUD + **WebAudio** radio — no libraries,
  no frameworks, no CDN, no external requests.
- Deterministic seeded RNG, so every run with the same seed plays the same.
- Static site: the whole game is `game/index.html` plus ES modules under
  `game/src/`.

## Credits

Sunset Bay is a fictional city. All art, audio, and code are original work
created for the make.fun bounty `gta6-01`.
