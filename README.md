# gta6-01

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Sunset Bay — an open-world crime game: drive and run through a low-poly sun-soaked coastal city at sunset, steal cars, run jobs for cash, and outrun the police as your wanted stars rise.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. No build step and no network — the game is plain static files (a raw-WebGL renderer written for this game, no library), played with keyboard and mouse: WASD to move and drive, mouse drag to orbit the camera, E to enter or exit a car, Shift to run, Space for the handbrake, R to restart, P to pause, M to cycle the radio, N to mute, Tab for the city map. Progress (best cash, jobs done, cars stolen, garage upgrades, ammo, armour, stash packs found) saves in your browser — Continue on the title screen resumes your last run.

## What's new in v4

- **3 new missions (15 total)** — Pier Pressure (pier drop, mall delivery), Beach Run (beach checkpoint, stash, safehouse) and Midnight Courier (mall pickup, far drop, shake the heat, vanish). All multi-stage, all with crew briefings.
- **Steering is progressive now** — the wheel turns less the faster you go, so holding a turn at medium speed arcs down the road instead of spinning you into a wall.
- **Walls slide and bounce** — a glancing hit slides the car along the wall and keeps most of its speed; a nose-first hit pivots the car along the wall, so holding full throttle for a second or two walks you out instead of leaving you wedged.
- **Crosshair** — a crisp centre crosshair appears whenever a gun is in hand on foot, so you can see where a click will land.
- **Drifts pay with a stock car** — the drift bar is 0.5 s (was 0.8 s) and the handbrake drags less, so a standard ride can hold a slide long enough to cash in.
- **Fair escapes on foot** — sprint is 12 u/s (was 10) against a cop's 9, and a cop must sit closer (5 units) and longer (4.5 s) to bust you, so running away actually works.

## What's in the Bay

- **15 named missions in stages** — First Wheels, Package Run, Cool Down, Street Race, Stash Grab, Getaway, The Big Heist, Bay King, Dockside Deal, Neon Nights, Payback Run, Sunset Showdown, Pier Pressure, Beach Run and Midnight Courier — with a mission card (timer, stage bar, next objective) and briefings from the crew: MARA the dispatcher, RICO the mechanic and DEX the wheelman.
- **Stash packs** — 6 hidden golden briefcases around town ($100 each, plus Respect): three on random roads, three at learnable spots — the pier end, Bay Park and the far beach. A STASH counter sits in the HUD pill and on the full-screen map; a found pack never respawns in that run.
- **Radio** — four synth stations (BAY FM, SUNSET DRIVE, NEON NIGHTS, PALM COURT) with named tracks, all generated live with WebAudio. M or the widget button changes station.
- **Combat on foot** — F to punch, click to fire, with a crosshair when a gun is in hand. Four weapon slots (fists, pistol, shotgun, SMG); guns unlock by picking up ammo, and ammo + armour are sold at the shop. Cops can be knocked down — but it adds heat.
- **Police response** — a live panel names every responding unit with its distance, tactic (PURSUIT / RAMMING / ROADBLOCK / BOXING IN) and IN SIGHT / SEARCHING status. At 4 stars a unit runs a roadblock ahead of you; at 3 stars the AIR-1 helicopter circles overhead, its spotlight slowing how fast your heat fades. The stuck-cop fix: a unit that makes no progress for 1.2 s reroutes to the nearest intersection instead of pushing at the same wall.
- **Garage, shop, safehouse** — spend cash at Sunset Garage on engine / armour / handling upgrades (or a $200 respray that wipes your wanted level), buy ammo and armour at the shop, and heal + cool off + save at the safehouse. The respray only jumps the queue at 2+ stars — at 1 star, G buys the upgrade you came for.
- **The city** — 8 named districts (Old Town, Downtown, Marina, West End, The Strip, Southside, Midtown, Harbor South), each with its own building palette and heights; neon facade trim, rooftop AC units and water towers, a few landmark towers above the district height range, wave bands on the ocean and beach umbrellas on the sand, plus warmer dusk lighting. Tab opens the full-screen map: districts, POI legend, mission list (DONE / ACTIVE / LOCKED) and run stats.
- **Rep & scores** — a Respect level (ROOKIE to BAY KING), health + armour bars, a TRACE heat bar under the wanted stars, and drift / near-miss score popups that pay cash (+$50 near miss, DRIFT ×multiplier).

---

<sub>Entered on [make.fun](https://make.fun/?ref=sygna1z3&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
