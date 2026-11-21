# Sunset Bay

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![make.fun · gta6-01 rank](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![make.fun · gta6-01 reward](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Sunset Bay** is an open-world 3D game that runs entirely in the browser. No installs, no
external requests — just open `game/index.html` (or serve the `game/` folder) and drive.

You wake up in a coastal sunset city with $250, no reputation, and a whole map of trouble
to get into. Steal cars, drift through corners for cash, take taxi fares, run 18 story
missions across 10 districts, dodge the police as your wanted level climbs, and escape by
speedboat from the marina when the heat gets too high. The city lives on a day/night cycle,
the radio has five synth stations, and your progress is saved so you can pick up where you
left off.

## Features

- Open world: ~220 buildings across 10 districts (Downtown, Old Town, Harbor, Marina Bay,
  Hillcrest, Northside, Southside, Beachfront, Uptown, Industrial), deterministic city
  (same layout every load, seed 7)
- 18 missions / 49 stages with REP rewards (+15 per stage, +40 per mission)
- Driving: steal cars, drift with Space (+$50 per drift), traffic AI, pedestrians
- Wanted system 0–5 stars, police chases, helicopter at 3+ stars, busted / wasted respawns
- Combat: pistol with ammo (buy +24 for $50 at the garage), police have health
- Speedboat at the marina (board with E) and a wooden pier on the water
- Taxi jobs and package side jobs for extra cash
- Garage & shop: ammo, respray ($150, clears wanted), engine upgrades, armour
- Fullscreen map (Tab) with mission list and stats, live minimap, day/night cycle
- Five synth radio stations (WebAudio, no audio files) and synthesized sound effects
- Save / Continue via localStorage, pause, title screen

## How to play

Serve the `game/` folder (any static server, e.g. `python3 -m http.server` inside
`game/`) and open it in a browser, or open `game/index.html` directly. The game is raw
WebGL with zero dependencies and works offline.

Start a New Game, follow the mission marker (yellow) on the minimap, and earn money and
REP. Getting busted costs 10% of your cash; getting wasted sends you back to the
safehouse. Save often — progress is stored in your browser.

## Controls

| Key | Action |
| --- | --- |
| W / A / S / D | Move / drive / steer |
| Shift | Run (on foot) |
| E | Steal / enter car, board or leave boat |
| F | Shoot pistol (respray when at the garage) |
| Space | Drift while driving (hold + steer, speed > 8) |
| M | Next radio station |
| Tab | Fullscreen map |
| P | Pause |
| G | Garage & shop |
| Mouse click | Shoot pistol |

## Tech

Raw WebGL, plain scripts (no build step, no framework, no external assets). All modules
attach to the global `window.SB` namespace; game state lives in `SB.G`. Screenshots are
staged with `?shot=start|play|foot|end`.

## License

MIT — see `LICENSE`.
