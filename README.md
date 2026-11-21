# Sunset Bay

[![Built on make.fun](https://make.fun/badge/built-on-makefun.svg)](https://make.fun)
[![Bounty: Make GTA 6](https://make.fun/badge/bounty-gta6.svg)](https://make.fun)
[![Play Sunset Bay](https://make.fun/badge/play-now.svg)](https://make.fun)

Sunset Bay is an open-world crime game that runs entirely in the browser.
Take the wheel in a sun-soaked coastal city inspired by Vice City: cruise
the boulevards, take on missions, earn cash, and stay one step ahead of
the law — all in a 3D world rendered with Three.js, no install needed.

Built for the [make.fun](https://make.fun) **Make GTA 6** bounty
([make.fun](https://make.fun)).

## How to play

- **W / A / S / D** — drive or walk
- **Space** — brake / handbrake
- **Shift** — boost
- **E** — enter or exit a vehicle
- **F** — interact with missions and pickups
- **C** — switch camera view
- **Mouse** — look around
- **Esc** — pause menu

Start a mission by driving to the glowing marker on the map. Finish it
fast and clean for a bigger payout, then spend your cash on new rides.

## Features

- Open 3D coastal city: downtown streets, beachfront, pier, and suburbs
- Drivable cars with arcade handling, traffic, and pedestrians
- On-foot mode with a third-person camera
- Mission system with timers, payouts, and wanted levels
- Day-to-night sunset lighting and a living city ambience
- Runs fully client-side — no server, no account, no download

## Run it locally

Requires Node.js 22 or newer. No dependencies to install.

```sh
node serve.ts
```

Then open <http://localhost:8080/> in your browser.

## Build the submission

```sh
node main.ts
```

This copies `game/` and `screenshots/` into the output directory
(`$MAKEFUN_OUTPUT_DIR`, or `./output` by default) and writes
`dossier.json` for the make.fun submission.

## License

Sunset Bay is released under the MIT License — see [LICENSE](LICENSE).
