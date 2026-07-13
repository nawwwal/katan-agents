# Local agent seats

The browser, built-in bots, and external agents all return the same `GameAction` JSON from a redacted `PlayerView`. The bridge binds only to `127.0.0.1:8787`; the Vite dev and preview servers proxy `/agent-api/*` to it.

## Start the built-in local runner

Start the bridge in the first terminal:

```bash
npm run bridge
```

Then start the game in a second terminal:

```bash
npm run dev
```

The bridge selects one legal action with a deterministic heuristic. This is the fast offline fallback; it does not launch an external model process.

## Attach a model runner

Set one operator-controlled command and a JSON array of fixed arguments before starting the bridge. The browser cannot change either value.

```bash
KATAN_AGENT_COMMAND=your-agent-cli \
KATAN_AGENT_ARGS='["your", "fixed", "arguments"]' \
npm run bridge
```

The command receives one prompt on stdin and must print one legal action as a JSON object. The bridge runs it in a new temporary directory, passes only `PATH`, `HOME`, `CODEX_HOME`, `LANG`, and `TMPDIR`, limits output to 64 KB, kills it after 30 seconds, validates the action against `legalActions`, then deletes the temporary directory. Discards and domestic trades may derive different non-negative resource quantities, but the bridge validates their required count, private-hand limits, participants, and disjoint give/receive bundles before the engine validates them again.

## Run the verified Codex seat

With an authenticated Codex CLI `0.144.0` or newer on `PATH`, start the Codex bridge in the first terminal:

```bash
npm run bridge:codex
```

Then start the game in a second terminal:

```bash
npm run dev
```

The adapter currently requests `gpt-5.6-sol` in an ephemeral, read-only, no-tool configuration. It explicitly disables both stable execution paths, `shell_tool` and `unified_exec`, in addition to plugins, apps, browser, memory, goals, multi-agent, image, computer-use, and hooks. Set `KATAN_CODEX_MODEL` only when deliberately changing the model; the adapter never silently downgrades it.

The decision endpoint requires the local game origin, reserializes only allowlisted `PlayerView` fields, admits one process at a time, aborts the child when playback is paused, the request disconnects, or the bridge shuts down, byte-caps both output streams, and returns stable error codes without child stderr.

## Player view contract

```json
{
  "v": 1,
  "revision": 42,
  "playerId": "p2",
  "phase": "action",
  "publicState": {},
  "privateState": {},
  "resourceCounts": { "p0": 5, "p1": 7, "p2": 4 },
  "legalActions": [
    { "type": "build-road", "edgeId": "e17" },
    { "type": "end-turn" }
  ]
}
```

The external process never receives a bearer token, arbitrary command arguments, or hidden state from another seat.
