# Local agent seats

A local agent is a real seat, not an in-game bot. One Codex task launches one stdio MCP process, claims one room seat, keeps its token inside that process, and connects outward to the same hosted WebSocket endpoint as every browser.

## Configure Codex

Add the server to your Codex MCP configuration. Use an absolute repository path.

```toml
[mcp_servers.katan]
command = "npm"
args = ["run", "mcp", "--prefix", "/absolute/path/to/katan-agents"]

[mcp_servers.katan.env]
KATAN_SERVER_URL = "https://your-katan.vercel.app"
```

For local development:

```toml
KATAN_SERVER_URL = "http://127.0.0.1:8787"
```

Restart the Codex task after changing MCP configuration.

## Invite one agent

1. Create a room in the browser.
2. Copy the agent prompt from the lobby.
3. Send it to a Codex task with the Katan MCP enabled.

```text
Use the Katan MCP. Join room ABC234 as Atlas. Read the rules, keep your
own personality, play to win from only your private view, and continue
calling wait_for_turn and play_action until the match ends.
```

For three agents, use three Codex tasks and the same room code. Each task has a separate MCP process, private seat, conversation, and personality.

## Tool contract

### `join_room`

Claims an `agent` seat while the room is in its lobby. Inputs are `code`, `name`, and an optional `serverUrl`. The tool returns the lobby and this process's player ID; it never returns the seat token.

### `read_rules`

Returns the concise base-game playbook, including setup, costs, robber, domestic and maritime trade, development cards, awards, victory, and the revision protocol. The same text is available at `katan://rules/base-game`.

### `get_view`

Returns:

- room status and seats;
- current revision, phase, actor, and whether this agent must act;
- this seat's private resources and development cards;
- public state, recent events, and current legal actions;
- optional board geometry when `includeBoard` is true.

Use board geometry for settlement, road, city, robber, harbor, and route decisions. It is optional because the 19-hex graph does not need to consume context on every turn.

### `wait_for_turn`

Waits on the live WebSocket instead of polling. It returns when this seat must act, the game finishes, or its 1–45 second timeout expires. Lobby joins and other players' moves are absorbed inside the same tool call, so the model does not spin while it waits.

### `play_action`

Takes the current `expectedRevision` and one action JSON object. It returns only after the authoritative room advances and browsers can observe the new revision. If another event won the race, it reports the stale revision and the agent must read again.

## Player-view example

```json
{
  "revision": 42,
  "phase": "action",
  "currentActorId": "p2",
  "isYourTurn": true,
  "privateState": {
    "resources": { "brick": 1, "lumber": 2, "ore": 0, "grain": 1, "wool": 0 },
    "development": [],
    "boughtDevelopment": []
  },
  "legalActions": [
    { "type": "build-road", "edgeId": "e17" },
    { "type": "end-turn" }
  ]
}
```

Opponent hands are represented only by public counts. The model cannot ask for full state, another seat's view, or server-side secrets.

## Operating loop

```text
join_room → read_rules
      ↓
wait_for_turn
      ↓
get_view(includeBoard when useful)
      ↓
play_action(expectedRevision, legal action)
      └────────────── repeat until finished
```

One turn may require several calls: settlement then road, discard then robber then victim, a trade response, Road Building's two roads, or action then end turn.

## Failure behavior

- If the MCP process disconnects, the room retains its seat and waits.
- If Vercel rotates the socket, the process reconnects and reloads the room.
- If an action is stale or illegal, the server does not mutate state and the agent must inspect the current view.
- If an agent task stops, no server-side fallback takes its turn.
- Seat credentials live only in the MCP process. A living process reconnects automatically; if it is destroyed, v1 cannot reclaim that seat.
- Redis-backed rooms expire 24 hours after their last mutation. Local in-memory rooms last until the room server stops.

## Local smoke test

Start the room service:

```bash
npm run rooms
```

The full automated check launches a real MCP child process, joins it beside two browser-style WebSocket clients, waits until the agent must act, submits a legal action, and verifies both browsers receive the new revision:

```bash
npm run check:mcp
```
