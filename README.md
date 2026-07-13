# Katan

A local-first 3D hex-island strategy game for humans, built-in bots, local agents, and spectators. The base rules follow the attached 2020 fifth-edition rulebook; the art and interface are original.

## Run it

```bash
npm install
npm run bridge
```

In a second terminal:

```bash
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). `npm run bridge` uses the fast offline heuristic for agent seats.

To exercise the production bundle with the same local-agent proxy, keep the bridge running and use:

```bash
npm run build
npm run preview
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

For the verified real Codex seat, use this instead in the first terminal:

```bash
npm run bridge:codex
```

The title screen offers a human match or an all-automated spectator match. Configure three or four seats and the reproducible island seed, review the snake setup, then enter the board. Placement targets preview before committing. The bottom tray handles rolls, negotiated trade offers and counteroffers, building, development cards, and ending a turn.

## What is implemented

- seeded 19-hex variable board, number tokens, ports, robber, and 3/4-player snake setup;
- resource production, bank shortages, seven/discard, robber movement, victim choice, and random steal;
- roads, settlements, cities, distance rule, piece limits, and costs;
- arbitrary multi-card domestic offers, accept/decline/counteroffer flow, and maritime trades;
- Knight, Road Building, Year of Plenty, Monopoly, and hidden victory cards;
- Longest Road, Largest Army, and active-turn victory at 10 points;
- one action contract shared by humans, bots, external agents, and spectators;
- authored 3D island with original hand-painted terrain albedos, distinct resource silhouettes, natural coast and lagoon, animated ships/water, responsive HUD, keyboard-accessible board targets, sound, reduced-motion support, and WebGL fallback copy;
- title, table configuration, onboarding, pausable spectator pacing, action feedback, standings, rematch, and return-to-title.

## Local agents

The app posts a seat-redacted `PlayerView` to `127.0.0.1:8787` and receives one legal `GameAction`. The included bridge can use a deterministic local heuristic or launch an authenticated Codex CLI in a temporary directory with read-only sandboxing and tools disabled.

To attach a local model runner, set an operator-controlled command before `npm run bridge`. The browser cannot supply commands, arguments, paths, tokens, or environment variables. See [docs/LOCAL_AGENTS.md](docs/LOCAL_AGENTS.md).

The state, controller, local-agent, and hosted-room boundaries are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Hosting

`npm run build` produces a static, root-hosted client suitable for a hosted human-versus-bot game. Serve it from `/` (the current asset and agent-proxy paths are absolute). The included dev and preview servers proxy same-device agent calls; another local server needs an equivalent `/agent-api` reverse proxy. Browsers loaded from a public HTTPS origin should not be expected to call a loopback HTTP process, so hosted local agents should use a signed desktop companion that connects outbound to the room host.

A fair multi-browser human deployment additionally needs an authoritative room service because a static site cannot keep private hands secret across clients. The existing revisioned action and redacted-view contract is the boundary for that service; WebSocket, HTTP polling, and agent adapters remain transports around the same engine.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Name and IP

`KATAN` is a local prototype codename. Do not publish it using CATAN branding, copied rules text, art, card designs, logos, or trade dress. A public release should use an original title and presentation or obtain permission from CATAN GmbH. The project takes only the general hex-settlement game structure and uses original generated art and UI.
