# Katan architecture

Katan uses four moving parts:

1. browser clients;
2. one Vercel Node service for rooms, WebSockets, and hosted MCP;
3. Redis for authoritative room state and cross-instance notifications;
4. one small local runner for each Codex or Claude seat.

There is no queue, worker fleet, database cluster, hosted model runtime, browser extension, or inbound localhost webhook.

~~~mermaid
flowchart LR
  H[Human browsers] <-->|personalized WebSocket snapshots| V[Vercel room and MCP service]
  R[Local Codex or Claude runner] <-->|outbound WebSocket wake stream| V
  M[Codex or Claude model] <-->|loopback MCP only| R
  V <-->|room snapshots and CAS writes| D[(Redis)]
  V <-->|capped room-change stream| D
  V --> E[Pure game reducer]
~~~

## Authority model

The server is the only live-game authority. A browser or agent can propose one action, but cannot roll dice, choose hidden cards, mutate a board, or advance a revision locally.

A live action follows this path:

1. authenticate the seat capability;
2. load the current room snapshot;
3. require the exact expected game revision;
4. require that seat to be the current actor;
5. parse the action against the seat's legal actions and private view;
6. run the pure reducer;
7. compare-and-set the next room snapshot in Redis;
8. append one room-change notification in the same Lua operation;
9. broadcast a separately redacted view to every connected seat.

A stale, illegal, malformed, or wrong-actor action fails without changing the room.

## Human flow

A human creates or joins a room over HTTP. The browser stores only its own room code, player ID, and random seat token in sessionStorage.

The browser then opens **/api/ws** and sends its room code and token in the first frame. Tokens never appear in URLs. Controls remain unavailable until an authenticated snapshot arrives.

Every later mutation carries a request ID and expected revision. Complete snapshots make reconnect simple: after sleep, network loss, or Vercel rotation, the browser authenticates again and replaces its local view.

## Agent flow

A live agent uses the same room and rules engine as a human.

### Join

Before its first network request, the runner creates:

- a random runner ID;
- a random join ID;
- a 256-bit random player key;
- an owner-only local state file.

The join request sends the join ID and proposed player key together. Redis stores only their SHA-256 hashes.

If the response is lost, the runner repeats the same pair. A matching join hash and token hash returns the original seat even when the room is already full or has started. A reused join ID with another key fails with **join_id_conflict**.

This makes ambiguous network failures safe without storing plaintext seat tokens on the server.

### Wake

The runner opens one outbound WebSocket and waits for an authenticated snapshot. It does not wake a model for lobby joins, animations, somebody else's dice roll, or passive trade events.

When the snapshot says **actionRequired: true**, the runner resumes one Codex or Claude session. Public events since the last model wake are available through the hosted MCP, including exact trade bundles between other players.

When the seat has no decision, the model returns control and the local process sleeps again.

### Action

The model talks to a random loopback MCP URL. The runner injects the seat bearer credential and forwards the request to **/api/mcp**. The model never receives the key in its arguments, environment, or tool inputs.

The hosted MCP uses the same room-service functions as browsers. **play_action** completes only after the authoritative room has advanced, so the runner can refresh immediately without a fixed delay.

## Why hosted MCP is stateless

Streamable HTTP MCP requests may land on different Vercel instances. Process-local seat or conversation state would therefore be incorrect.

Every hosted tool call contains either:

- a playerKey argument for a manual MCP client; or
- a bearer capability injected by the local runner.

Redis resolves that capability to one seat on every request. The MCP process itself owns no durable game state, so retries and instance rotation are ordinary.

The endpoint is:

~~~text
https://katan-agents.vercel.app/api/mcp
~~~

It publishes the base rules, autonomous-player skill, tool schemas, and play prompt. It does not run a model or keep one awake.

## Why the local runner exists

MCP standardizes tools, resources, and prompts. It does not give every desktop agent a portable, always-on server-to-client wake primitive.

A literal webhook from Vercel to localhost would fail for most friends because laptops sit behind NAT, firewalls, sleep, changing addresses, and private networks. The runner instead initiates one outbound WebSocket, the same network direction browsers already use.

This also keeps cost predictable. Passive game traffic is tiny, and model inference happens only on the player's machine when that seat must choose.

## Player views and privacy

Every seat receives:

- the public board, roads, buildings, bank, dice, robber, awards, phase, and event timeline;
- public resource and development-card counts;
- public scores;
- exact terms of public domestic trades;
- its own exact resources and development cards;
- legal actions only for its current decision.

It never receives:

- another seat's resource identities;
- another seat's development-card identities;
- the development deck;
- private random state;
- another seat token;
- another seat's legal actions.

Public trade terms are deliberately retained in historical events. An agent waking after two other players negotiated can understand what happened without learning either hidden hand.

## Redis layout

Local development uses an in-memory implementation of the same interface. Production requires **REDIS_URL**.

| Key | Purpose |
|---|---|
| **katan:room:{CODE}** | Authoritative room snapshot, game state, and seat/join hashes |
| **katan:room-events** | Capped cross-instance room-change stream |
| **katan:rate:{SCOPE}:{HASH}** | Expiring create, join, socket, and MCP request counters |

Rooms expire 24 hours after their last mutation.

### Optimistic writes

The room snapshot's monotonic **updatedAt** value is the compare-and-set version. A Lua script writes the new room and appends its stream event only when the observed value is still current.

Conflicts reload and retry from fresh state. Player actions also carry a game revision, so a duplicate or late action is rejected before the reducer runs.

There is no expiring distributed lock that can lose ownership during a runtime pause.

### Cross-instance realtime

A function instance starts a blocking Redis Stream reader only while it has authenticated local sockets or a compatibility waiter. A stream event tells it which room to reload.

The ordinary Redis command client has bounded retries and a five-second command timeout. The dedicated blocking reader keeps reconnect-friendly retry behavior and a bounded blocking-socket timeout. A Redis outage therefore fails user commands quickly without breaking long-lived stream recovery.

## WebSocket liveness

A connection is not considered ready at TCP open.

Both browser and runner flows authenticate with a seat token and receive a full snapshot. The runner adds:

- a ten-second authenticated-snapshot deadline;
- application pings every twenty seconds;
- pong freshness checks;
- forced reconnect for half-open sockets;
- bounded 500 ms to 8 s backoff;
- a complete state reload after every reconnect.

Snapshots naturally coalesce while a model is busy. The latest authoritative room wins; the next MCP view supplies the public event delta from the saved revision cursor.

## Local runner security

The runner is dependency-free on Node 22.12+ and creates no externally listening port.

Its loopback proxy:

- binds to 127.0.0.1 on an ephemeral port;
- uses a random unlogged path;
- forwards only to one fixed hosted MCP URL;
- strips authorization, host, forwarding, connection, and length headers;
- injects the seat bearer credential in memory;
- rejects redirects;
- caps request and response bodies;
- closes with the runner.

Model processes start in a private, empty, stable per-seat directory with a small environment allowlist. The stable path is important because Claude scopes resumable sessions to the working directory.

For Codex, user configuration and rules are ignored, shell approvals are disabled, the sandbox is read-only, and shell, unified execution, browser, apps, image generation, workspace helpers, and multi-agent features are disabled. Only the four runner-safe Katan MCP tools are enabled and pre-approved for non-interactive execution.

For Claude, settings sources, slash commands, browser integration, built-in tools, and unrelated MCP servers are disabled. A strict one-server MCP config loads the four runner-safe Katan tools up front, and the init event is validated before the wake counts as successful.

A decision has a three-minute wall-clock limit. SIGINT, SIGTERM, and timeouts terminate the process group gracefully and then force-kill it if needed. Three failures or three no-progress exits at one revision stop the runner instead of spending indefinitely.

Local recovery state uses a 0700 directory, 0600 files, and atomic rename. It remains readable by the same operating-system user; the system does not claim protection from the computer owner.

## Hosted MCP hardening

The public MCP surface has:

- Streamable HTTP in sessionless JSON-response mode;
- Origin validation for browser-originated requests;
- per-IP rate limiting;
- a 64 KiB request-body cap before SDK parsing;
- SDK-owned JSON-RPC and content-negotiation validation;
- stateless server creation per request;
- seat-scoped bearer or explicit capability authentication;
- redacted player views;
- no arbitrary upstream URLs or callbacks.

**wait_for_event** is a compatibility fallback. At its deadline it performs one final authenticated read, preventing a just-arrived event from being returned as a stale timeout.

## Vercel shape

One Vercel project serves:

- the Vite browser build;
- room HTTP routes;
- the native WebSocket endpoint;
- the hosted MCP endpoint;
- the versioned local-runner tarball.

Native WebSockets keep each connection on one function instance. Redis makes room state durable and fans changes across instances. The function duration can end normally; clients reconnect and rehydrate.

**REDIS_URL** is mandatory when the Vercel environment is present. Health returns 503 and room commands fail rather than creating per-instance memory islands.

## Cost model

For a four-player turn-based game:

- one small Redis room snapshot changes per legal action;
- one capped stream event notifies other function instances;
- each connected seat receives one redacted snapshot;
- passive agent events do not invoke a model;
- no queue polling, background worker, hosted inference, or per-room process runs.

This is both the simplest robust design and the cheapest one that preserves immediate trading and turn updates.

## Deliberate omissions

The system does not currently add:

- an account or OAuth layer;
- Postgres match history;
- a queue or worker fleet;
- arbitrary user webhooks;
- MCP Tasks as a wake mechanism;
- a browser extension;
- hosted agent inference;
- an in-game fallback bot;
- a spectator credential;
- rankings, searchable replays, or analytics.

Add Postgres when durable accounts, replay search, or rankings become product requirements. Add signed webhooks only for a specific hosted agent provider with a public callback. Add a queue only when delivery must survive a prolonged outage at such a hosted callback.

## Main files

| File | Responsibility |
|---|---|
| **api/server.ts** | Vercel Node entrypoint |
| **server/realtime-server.ts** | HTTP routes, WebSocket authentication, and broadcast |
| **server/room-service.ts** | room lifecycle, Redis CAS, idempotent joins, redaction, and rate limits |
| **server/hosted-mcp.ts** | stateless hosted MCP transport and tools |
| **server/mcp-content.ts** | bundled rules, player skill, and prompt |
| **server/mcp-view.ts** | compact cursor-based agent view |
| **server/mcp.ts** | local stdio adapter for development and compatibility |
| **agent-runner/bin/katan-agent.mjs** | local Codex/Claude lifecycle, recovery, proxy, and wake loop |
| **src/game/room.ts** | shared room wire types and untrusted action parser |
| **src/game/engine.ts** | pure base-game reducer and player-view builder |
| **src/game/useGame.ts** | browser connection and reconnect state |
| **src/agent/invite.ts** | versioned runner and manual MCP invite commands |

## Verification

The repository keeps checks focused on architecture boundaries:

- pure board, rules, engine, integrity, and simulation checks;
- room authentication, idempotent join, realtime fanout, and stale-action checks;
- local stdio MCP discovery and browser-observed action checks;
- hosted MCP size limit, resources, redaction, event cursor, and wait-deadline checks;
- a dependency-free runner integration check with fake Codex and Claude executables.

The runner check proves seat recovery, 0600 state, secret isolation, Codex session resume, authenticated reconnect, pong recovery, no-progress limits, decision timeout, and child-process shutdown without spending model tokens.
