[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# Sunset Bay — GTA 6 style open world

Sunset Bay is a GTA 6 style open-world game built with raw WebGL — no
libraries, no network requests, every asset generated procedurally in code.
Drive, steal, race, and pull off a three-phase heist across 14 districts of
a coastal city at golden hour, while the sun hangs low and orange over the
bay.

## What is inside

- **A living city**: 301+ buildings across 14 districts (Marina Bay, Old
  Town, Fisherman's Wharf, Sunset Strip, North Hills, East Market, Harbor
  Point, Palm Court, Coral District, Beacon Hill, Little Havana, Airport
  South, University Row, Industrial Docks), 42 cars, 34+ pedestrians, 38
  AI traffic cars, 6 boats, and a helicopter chase at sunset.
- **22 missions / 79 stages** — from courier runs to the big heist
  (recon → prep → execute), paying cash and district respect.
- **Wanted system (0–5 stars)** — police cars and foot cops pursue you;
  hide to cool the heat down.
- **Money**: cash pickups, taxi and courier jobs, 6 street races with
  checkpoints, weapon shop, and car respray ($150).
- **Crew of 5** — recruit, assign jobs, and grow loyalty by succeeding
  together. **Respect ranks (5)** and district standing (0–100 per
  district) unlock better prices and missions.
- **3 weapons** (pistol, SMG, shotgun) in 3 slots, **6 radio stations**
  (synthesized WebAudio), local weather per district, day/night cycle,
  rain that changes car handling, particle effects, and water wakes.
- **HUD + minimap**, save / continue via localStorage, pause, game over
  and win screens.

## How to play

Serve the game locally and open it in a desktop browser with WebGL:

```sh
node serve.ts
# open http://localhost:8901/
```

Or open `game/index.html` directly from any static file server. No build
step, no dependencies — Node 22 standard library only, and the game itself
is plain JavaScript + raw WebGL.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Walk / drive |
| Shift | Sprint |
| Mouse | Look around (click the game to lock the mouse) |
| E | Steal nearest car / get out |
| Space | Brake |
| R | Respray car ($150) |
| F | Interact |
| 1 / 2 / 3 | Switch weapon |
| Left click | Shoot |
| Q | Next radio station |
| M | Mute |
| H | Horn |
| Esc / P | Pause |

Follow the yellow marker on the minimap to reach your mission. Stealing
cars and shooting raise your wanted level — break line of sight and stay
hidden to cool down. Earn cash, build respect in all 14 districts, and
finish the heist to win the city.

## License

MIT — see [LICENSE](LICENSE).
