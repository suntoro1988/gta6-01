# Sunset Bay

![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)
![make.fun · gta6-01 rank](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/rank.svg)
![make.fun · gta6-01 reward](https://make.fun/badge/gta6-01/suntoro1988/gta6-01/reward.svg)

Sunset Bay is a 3D open-world game that runs entirely in the browser — a
sun-drenched coastal city, built for the
[make.fun gta6-01 bounty](https://make.fun/bounty/gta6-01). No install, no
download, no account: serve the `game/` folder and drive straight into the
sunset.

## The city

Ten districts stretch from the Downtown towers to the beach, the marina, and
the quiet suburbs, all connected by roads you can actually drive. The clock
runs from golden hour into the night, the sea glints beside the highway, and
the police are always watching.

## What you can do

- **18 missions** — jobs across the city: getaways, deliveries, chases, and
  scores that pay out in cash and street cred.
- **Drive and drift** — steal any car on the street, hold Space to drift
  through corners, and chain drifts to build your score.
- **On foot or behind the wheel** — walk the sidewalks, jack a ride with E,
  or run from the law on foot when a plan falls apart.
- **Radio** — flip stations with M while you drive; BAY FM keeps the sunset
  mood going.
- **REP and wanted stars** — earn REP by finishing missions and pulling off
  drifts; earn wanted stars by making a mess, then lose the heat with a
  respray at the garage.
- **Garage and shop** — spend your cash on ammo, engine upgrades, armour,
  and a fresh coat of paint.

## How to play

```sh
node serve.ts
# then open http://localhost:8080
```

Click **New Game** on the title screen and the city is yours.

| Key | Action |
| --- | --- |
| W A S D | Move / drive |
| E | Enter or steal a car |
| F | Shoot / respray |
| Space | Drift |
| Shift | Run |
| M | Change radio station |
| Tab | City map |
| P | Pause |
| G | Garage |

## Tech

Pure HTML, CSS, and JavaScript with WebGL — no build step, no bundler, no
framework. The game lives in `game/` (`index.html` plus `src/*.js`), the
entrypoint `main.ts` stages it and writes the make.fun dossier, and
`shots.json` describes the four screenshots in `screenshots/`.

## License

MIT — see [LICENSE](LICENSE).
