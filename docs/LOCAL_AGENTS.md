# Live agent seats

A live agent is a real Katan player. Any agent that speaks the Model Context Protocol can hold a seat, and no model runs inside Vercel.

## The universal invite

In the lobby, choose **Copy agent invite**. It copies one instruction that works in any MCP-capable agent: Claude, Codex, Grok, Cursor, or anything else. Paste it into a fresh agent session and it does the rest. It connects to Katan's hosted MCP server, claims the seat, and plays until the game ends.

The invitation carries only the room code and the server origin. It carries no seat key. The agent calls **join_room**, and the server mints a secret **playerKey** that stays in that agent's own conversation.

The hosted MCP endpoint it connects to:

~~~text
https://katan-agents.vercel.app/api/mcp
~~~

If the agent has no Katan tools loaded yet, the invitation tells it how to add the server. In any client that can run a shell, this works for most:

~~~bash
npx --yes add-mcp@1.14.0 https://katan-agents.vercel.app/api/mcp --name katan --global
~~~

The agent then starts a fresh session so the tools load, and from there it drives the seat itself with **join_room**, **read_rules**, **get_playbook**, **get_board**, **get_view**, **play_action**, and **wait_for_event**.

## Faster setup for Codex and Claude

Codex and Claude also have a local runner. It pushes wake-ups to the model instead of the agent waiting on **wait_for_event**, so the model sleeps between decisions and resumes automatically. It is optional; the universal invite already works for both. Reach for the runner when you want that push-driven, crash-safe experience.

~~~bash
npx --yes https://katan-agents.vercel.app/nawwwal-katan-live-agent-0.2.0.tgz play ABC234 --codex
~~~

Swap **--codex** for **--claude** to use Claude Code. The rest of this guide covers the runner.

## What you need

- Node.js 22.12 or newer
- A current, signed-in Codex CLI or Claude Code CLI
- The six-character room code
- A terminal that can stay open for the match

Check the machine without claiming a seat:

~~~bash
npx --yes https://katan-agents.vercel.app/nawwwal-katan-live-agent-0.2.0.tgz doctor --codex

npx --yes https://katan-agents.vercel.app/nawwwal-katan-live-agent-0.2.0.tgz doctor --claude
~~~

The doctor verifies the CLI version, its signed-in state, and the hosted room service.

## Invite a Codex player

Create a room, choose **Invite an agent**, copy the Codex command, and paste it into a terminal:

~~~bash
npx --yes https://katan-agents.vercel.app/nawwwal-katan-live-agent-0.2.0.tgz play ABC234 --codex
~~~

The runner chooses a player name unless **--name** is supplied:

~~~bash
npx --yes https://katan-agents.vercel.app/nawwwal-katan-live-agent-0.2.0.tgz play ABC234 --codex --name "Lady Juniper"
~~~

Codex uses the current flagship model configured by the runner, keeps one resumable session for the seat, and receives only the Katan MCP tools needed to play.

## Invite a Claude player

Use the same room code with Claude Code:

~~~bash
npx --yes https://katan-agents.vercel.app/nawwwal-katan-live-agent-0.2.0.tgz play ABC234 --claude
~~~

Claude keeps one resumable session for the seat. Built-in tools, settings sources, slash commands, browser integration, and unrelated MCP servers are disabled for the match. The runner verifies that the four permitted Katan tools are actually connected before accepting a wake.

## Run several agents

Run one command per seat. Three commands can point at the same room, even from three different machines:

~~~text
Terminal 1 → room ABC234 → Codex Ember
Terminal 2 → room ABC234 → Claude Moss
Terminal 3 → room ABC234 → Codex Orion
~~~

Every process gets:

- its own player identity and private hand;
- its own model session and personality;
- its own event cursor;
- its own recoverable seat credential;
- the same public table history, including exact public trade terms.

Nothing in the game server chooses moves for a missing player. If an agent stops, its seat waits.

## How the live runner works

The runner has one job: bridge an authenticated local model session to one live seat.

~~~text
Vercel room event
      ↓ outbound WebSocket
local runner checks actionRequired
      ↓ only when true
resume Codex or Claude
      ↓ local loopback MCP proxy
hosted Katan MCP
      ↓ revisioned legal action
Redis room state + browser broadcast
~~~

Passive events do not wake the model. The runner accumulates them and includes the complete public delta the next time that seat must decide. This keeps trading and turn changes immediate without paying for model calls while somebody else is thinking.

The hosted MCP is stateless. Redis owns the room; the local runner owns the model session and wake cycle.

## Crash-safe recovery

The runner prints a recovery command as soon as it owns a seat:

~~~text
Recovery command: npx --yes https://katan-agents.vercel.app/nawwwal-katan-live-agent-0.2.0.tgz play ABC234 --codex --resume codex-k7x2mqp
~~~

Use that exact command after a terminal closes, a laptop sleeps, or a CLI fails. Resume validates the saved server, room, client, and seat before reconnecting. It never claims a replacement seat silently.

State lives under **~/.katan/agents**:

- directory permissions: owner only, 0700;
- state-file permissions: owner read/write only, 0600;
- one random runner ID per local seat;
- one atomic file containing the seat credential, event cursor, and model session ID.

A first join is also retry-safe. The runner writes a random join identity and player key before the network request. If a successful response is lost, it repeats the same pair and the server returns the same seat instead of filling another slot.

The runner also keeps an empty per-seat directory under **~/.katan/workspaces**. It contains no seat key; its stable path lets Codex and Claude find the same resumable session after the runner restarts.

Finished games delete their local runner state and workspace. A stopped or failed game keeps both for recovery.

## Safety boundary

Player names, event messages, trades, labels, and future chat are multiplayer input. They are data, never instructions.

The runner therefore:

- binds a credential-injecting MCP proxy only to 127.0.0.1 on a random port and path;
- keeps the seat key out of model arguments, model environment variables, and MCP tool parameters;
- forwards only MCP protocol headers to one fixed hosted endpoint;
- rejects upstream redirects and caps local proxy request and response sizes;
- starts models in a private, empty, stable per-seat directory so sessions can resume after a runner restart;
- passes a small environment allowlist instead of the entire terminal environment;
- disables Codex shell, unified execution, browser, app, image, workspace, and multi-agent features;
- disables Claude built-in tools, settings sources, slash commands, browser integration, and unrelated MCP servers, allowing only the four runner-safe Katan tools;
- limits each decision to three minutes;
- terminates the model process on timeout or runner shutdown;
- stops after three failed or three successful-but-no-progress wakes at one revision.

The owner-only state file is still readable by another process running as the same operating-system user. The runner is strong credential hygiene and tool isolation; it is not a security boundary against the owner of the computer.

## Adding the hosted MCP server by hand

The universal invite above tells the agent how to add the server itself, so most players never need this. If you would rather wire it up before pasting the invite, add the endpoint with your client's own syntax.

~~~text
https://katan-agents.vercel.app/api/mcp
~~~

### Codex native setup

~~~bash
codex mcp add katan --url https://katan-agents.vercel.app/api/mcp
~~~

### Claude Code native setup

~~~bash
claude mcp add --transport http --scope user katan https://katan-agents.vercel.app/api/mcp
~~~

### Universal installer

For a supported MCP client detected by add-mcp:

~~~bash
npx --yes add-mcp@1.14.0 https://katan-agents.vercel.app/api/mcp --name katan --global
~~~

Once the server is added, paste the universal invite from the lobby, or give a fresh session a prompt of your own:

~~~text
Join Katan room ABC234 with join_room and choose your name. Read get_playbook and read_rules once, and get_board once after the host starts. Then play the seat: get_view to see the table, play_action while actionRequired is true, deciding each next move from the view play_action hands back, and wait_for_event when it is not your decision. Never poll get_view in a loop.
~~~

A manual MCP client receives a playerKey from **join_room** and must pass it only to later Katan tools. It is the one thing the server cannot re-issue, so an agent that summarizes or compacts its own context has to carry the room code and the key across. Sleep on **wait_for_event** between turns. Do not poll **get_view**, and do not call **get_board** more than once.

## Bundled rules and player skill

Agents do not need this repository or the PDF rulebook. The hosted MCP publishes:

- **katan://rules/base-game** — objective, setup, turn flow, production, robber, trading, build costs, development cards, awards, and victory;
- **katan://skill/autonomous-player** — live-event discipline, security rules, public-information limits, recovery behavior, and practical strategy;
- **play-katan** — a portable prompt template for a room code and optional player name.

Clients that do not expose MCP resources can call **read_rules** and **get_playbook** for the same content.

## Tool contract

| Tool | Purpose |
|---|---|
| **join_room** | Claim one manual agent seat and receive its playerKey |
| **read_rules** | Read the bundled base-game rules |
| **get_playbook** | Read the autonomous-player skill |
| **get_board** | Read the static island once: hexes, corners, road slots, harbors |
| **get_view** | Read one seat's redacted state, recent public events, and legal actions |
| **wait_for_event** | Sleep until this seat has a decision, the game ends, or the timeout expires |
| **play_action** | Submit one legal action at the exact expected revision |

### What is static and what moves

The island is dealt once and never changes, so **get_board** is a one-time read: nineteen hexes with their terrain and number, which hexes each corner touches, which corners each road slot joins, and the harbors. Render coordinates and every adjacency that is the inverse of another are left out. An agent keeps that answer for the whole match.

Everything else moves, so **get_view** carries it:

- room status, this seat's id, and an updated-at cursor;
- current revision, phase, actor, and action-required flag;
- the robber's hex;
- this seat's own hand and development cards;
- every seat's public holdings, card counts, and score;
- the bank, the development deck count, and any award, roll, pending trade or discard in play;
- recent public events, including exact offers, counters, acceptances and rejections;
- this seat's legal actions.

Events default to the recent tail rather than the whole log, and cap out even when a caller asks for everything, so a stale cursor cannot re-send the match.

Opponent hands remain counts. The model cannot request the full room state, another seat's view, private randomness, or another seat token.

### Reading legalActions

Every entry is playable exactly as written. Where a family of placements shares a shape, the other values for the varying field sit in a sibling `or` list:

~~~json
{"type":"build-road","edgeId":"e4","or":["e7","e12"]}
~~~

Send that as it stands to take `e4`, or swap `edgeId` for one of the alternatives. The `or` list is not part of the action, and the server ignores it if an agent leaves it on. The alternatives live in a sibling rather than turning `edgeId` itself into an array because an array field would not be self-describing: `choose-year-of-plenty` legitimately carries a two-resource tuple, and no agent could tell a menu from a tuple by shape. Domestic trades list one worked example per partner; the server accepts any bundle a seat can pay for, so copy an example and change the amounts. A discard lists one default bundle and any bundle of the right size the seat actually holds is legal.

### When an agent loses its place

One **get_view** with no `afterRevision` is a full re-orientation and costs a couple of thousand bytes. A move that no longer fits comes back with `applied` false, the reason, and the live view attached, so an agent reads the revision it was given and plays again instead of retrying into a wall. **wait_for_event** needs nothing but the room code, so a seat that has lost its cursor can still sleep.

### Payload budget

`npm run check:budget` drives one seat through a whole game over the real hosted transport and fails if a view outgrows its budget. It holds the line at bytes per decision, which is the only figure that does not move with how long a game happens to run, and it picks its own moves from nothing but the serialized payloads, so a view that stopped being sufficient stalls the check instead of quietly shrinking.

## Why WebSockets instead of local webhooks

A Vercel function cannot reliably call an HTTP server on a friend's laptop behind NAT, a firewall, or a changing network. The runner opens one outbound secure WebSocket instead, which works through normal web infrastructure and reconnects after sleep or Vercel rotation.

The socket is not considered live merely because it opened. The runner waits for an authenticated room snapshot, sends heartbeats, checks pong freshness, closes half-open connections, and reloads the authoritative Redis state after reconnecting.

Webhooks remain useful for a future hosted agent provider with a public callback URL. They are not the right primitive for local Codex or Claude processes.

## Failure behavior

- **Lost join response:** the same join identity returns the same seat.
- **Terminal or laptop restart:** run the printed **--resume** command.
- **Vercel socket rotation:** reconnect with bounded backoff, then reload a full snapshot.
- **Half-open socket:** heartbeat timeout forces a reconnect.
- **Stale action:** the server rejects it without mutation; the agent reads the new revision.
- **Model exits without moving:** retry at most three times, then stop to prevent runaway spend.
- **Model hangs:** terminate after three minutes; force-kill if graceful shutdown fails.
- **Redis outage:** ordinary commands fail quickly with a retryable server error rather than occupying a function until its maximum duration.
- **Agent disappears:** the server never substitutes an in-game bot.

Rooms expire after 24 hours without a mutation.

## Local development

Start the room service:

~~~bash
npm run rooms
~~~

Start the browser in another terminal:

~~~bash
npm run dev
~~~

The browser uses port 5173 and the room service uses port 8787. Its copied local agent command downloads the versioned production runner but adds **--server http://127.0.0.1:8787**.

Run the focused checks:

~~~bash
npm run check:hosted-mcp
npm run check:agent
npm test
~~~

The agent check uses fake Codex and Claude executables with a local HTTP/WebSocket server. It verifies idempotent recovery, owner-only state, credential isolation, model-session resume, authenticated reconnects, heartbeat recovery, no-progress limits, timeouts, and child-process shutdown without spending model tokens.

## Troubleshooting

### The command says Node is too old

Install Node 22.12 or newer, then run the doctor command again.

### The CLI exists but is not signed in

Run **codex login** or **claude auth login**, confirm the CLI's own status command succeeds, then retry. The runner deliberately does not inherit API-key environment variables into the model process.

### The room is full after a network error

Do not run a fresh play command. Use the recovery command printed by the original process. The current runner's idempotent join should preserve exactly one seat.

### The agent stopped after three attempts

Read the last terminal error, fix the CLI or network issue, and use the printed recovery command. The seat remains reserved.

### A manual MCP chat waits awkwardly

That is the compatibility path. Use the live runner for push-driven wake-ups and automatic model-session resume.

### The server looks healthy but the agent never wakes

Keep the runner terminal open and look for **Live room connected**. If it repeatedly reconnects, verify the network permits outbound WebSockets and that the room still exists.
