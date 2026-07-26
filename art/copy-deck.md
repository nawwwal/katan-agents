# Katan copy deck

Written July 26, 2026, against the live build at 127.0.0.1:5173 and the source at
that commit. Every player-facing string in the game, what it should say instead,
and the meta commentary that should never have shipped.

This is a specification, not a patch. Another agent applies it.

**How to locate a string.** `src/ui/Journey.tsx`, `src/App.tsx`, `src/game/` and
`server/` are being restructured while this is written, so every row is anchored
by its current text plus the component and the condition that renders it. Line
numbers are a hint for the first pass only. If a line number misses, search the
"Now" column.

---

## 1. The voice

**Who is speaking.** The island keeps a log, and someone who has watched a
hundred crossings is writing in it. That person is competent, unsentimental and
on your side. They tell you what happened, in the fewest words that are still
specific, and when something blocks you they tell you the way out in the same
breath. They do not perform. They do not congratulate you for rolling a six.
They have no jokes, because on the fortieth turn a joke is furniture. When you
finally win they say so plainly and mean it, and that restraint is what makes it
land.

**Register.** Between a ship's log and a good rulebook. Concrete nouns, active
verbs, present tense for what is happening and past tense for what happened.
Second person for the player, proper names for everyone else. The sea is present
in the vocabulary (aboard, ashore, crossing, harbour) but it is never decoration,
and there is at most one such word per screen.

**Rules.**

- No em dashes. Full stop or a new sentence.
- No exclamation marks. Not one, anywhere. The victory screen earns its weight
  from being quiet.
- Name the missing thing. "A road costs 1 brick and 1 lumber" beats "not enough
  resources", and "One seat is still open" beats "fill every seat".
- Every refusal ends with the next move. If there is no next move, say that.
- Short. The player is reading mid-decision.
- One spelling standard: American. Harbor, center, neighboring, color. The board
  options panel currently says "Harbours" and "Centre" while the trade dialog
  says "Harbor". Fix the panel.
- Sentence case for body and buttons. The stylesheet handles the small-caps
  kickers, so do not type strings in caps.
- Never use the word "user", "resource" as a synonym for card in player-facing
  text, or "utilize".

**What the voice is not.** Not fantasy pastiche. "The island recognizes a new
steward" and "secured the crown" both go. Not product marketing. "Tactile
local-first hex island strategy game" goes. Not whimsy. There is no mascot.

---

## 2. The characters

The client's note was specific: Atlas and Ember are placeholder names from a
random generator, and a player spends an hour with these opponents.

### Where the names come from today

| File | What it does |
| --- | --- |
| `src/game/engine.ts` | `const NAMES = ['You', 'Agent Blue', 'Agent Amber', 'Ivory Guild']`, the fallback roster for any game created without explicit names |
| `src/App.tsx` | `names: ['You', 'Atlas', 'Ember']` in `buildUiPreview` and in the title-screen `previewGame` |
| `src/scene/structures/PiecesLab.tsx` | `names: ['You', 'Atlas', 'Ember']` in `networkState` |
| `agent-runner/bin/katan-agent.mjs` | `const names = ['Ember', 'Juniper', 'Moss', 'Atlas', 'Pippin', 'Saffron', 'Clover', 'Orion', 'Wren', 'Tamarind']`, sampled at random and prefixed with `Codex ` or `Claude ` |
| `src/agent/invite.ts` | `buildAgentPlayPrompt` tells the model to "choose your own name and personality" |
| `server/mcp-content.ts` | `playPromptText` says "Choose a distinct personality" |

Two problems. `Agent Blue` and `Ivory Guild` are not names. And a seat that
announces itself as "Codex Ember" is telling the player which vendor is running
it, which is the least interesting fact about the opponent.

### The cast

Three characters, because a four-seat table has at most three agent opponents
once the human takes a seat. A fourth is included for the case where every seat
is an agent. Names are single words so they fit the player rail, start with
distinct letters (the crest renders the first character), and read as people on a
settlement roster rather than as a fantasy party.

| Seat colour | Name | One line, shown in the lobby and the log | Who they are |
| --- | --- | --- | --- |
| blue | **Marlow** | Harbour pilot. Trades early, trades often. | Talks to everyone, takes thin deals to keep the lanes open, and is usually two roads further along than you noticed. Named for the mariner who narrates rather than acts. |
| amber | **Ansel** | Surveyor. Quiet until the ore adds up. | Says nothing for twenty turns, then converts three settlements to cities in two. A surveyor is a settlement job, not a fantasy job, which is the point. |
| ivory | **Solveig** | Road boss. Takes the long way and gets there first. | Plays for Longest Road and will spend a turn on a road that looks pointless. Nordic, coastal, unglamorous. |
| coral | **Bram** | Ferryman. Impatient, and it shows. | Only appears when the human is not in seat one. Rolls, builds, ends. Named short because he would not want a long one. |

**Reasoning.** Every name is a real name a person could have had in a coastal
town in the last two hundred years. None of them is a noun promoted to a name
(Ember, Moss, Clover, Atlas all are). None of them is an adjective. Each has one
sentence of behaviour that is legible at the table within ten turns, so the line
in the lobby turns out to be true rather than flavour text. The occupations are
the game's own vocabulary: pilot, surveyor, road boss, ferryman.

### Changes required

| File | Now | Should be |
| --- | --- | --- |
| `src/game/engine.ts` `NAMES` | `['You', 'Agent Blue', 'Agent Amber', 'Ivory Guild']` | `['You', 'Marlow', 'Ansel', 'Solveig']` |
| `src/App.tsx` `buildUiPreview` and `previewGame` | `names: ['You', 'Atlas', 'Ember']` | `names: ['You', 'Marlow', 'Ansel']` |
| `src/scene/structures/PiecesLab.tsx` `networkState` | `names: ['You', 'Atlas', 'Ember']` | `names: ['You', 'Marlow', 'Ansel']` |
| `agent-runner/bin/katan-agent.mjs` `names` | `['Ember', 'Juniper', 'Moss', 'Atlas', 'Pippin', 'Saffron', 'Clover', 'Orion', 'Wren', 'Tamarind']` | `['Marlow', 'Ansel', 'Solveig', 'Bram', 'Idris', 'Nell', 'Halloran', 'Tova']` |
| `agent-runner/bin/katan-agent.mjs` `defaultName` | `` `${options.client === 'codex' ? 'Codex' : 'Claude'} ${names[randomInt(names.length)]}` `` | `names[randomInt(names.length)]`. Drop the vendor prefix. The lobby already labels the seat "Local agent", which is the fact a player needs. |
| `agent-runner/bin/katan-agent.mjs` help text | `katan-agent play ROOM_CODE --codex [--name "Codex Ember"]` | `katan-agent play ROOM_CODE --codex [--name "Marlow"]` |
| `src/agent/invite.ts` `buildAgentPlayPrompt` | `Join Katan room ${code}, choose your own name and personality, read the bundled player playbook, and play until the game ends.` | `Join Katan room ${code} under the name the runner gives you. Read the bundled player playbook, play the personality in your seat brief, and keep playing until the game ends.` |
| `server/mcp-content.ts` `playPromptText` | `Choose a distinct personality, play to win, and continue until the game ends.` | `Play the personality your seat was given, play to win, and continue until the game ends.` |

**Also add:** a `persona` line per character, sent to the agent with its seat so
Marlow actually trades early and Solveig actually chases road length. One
sentence each, the same sentence shown in the lobby. Without this the names are
still decoration. Put it next to the roster in `agent-runner/bin/katan-agent.mjs`
and pass it through `join_room`.

---

## 3. Every player-facing string

Grouped by surface. **File** column tells the application pass which agent's
territory a row lands in.

### 3.1 Document head and shell

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| `<meta name="description">` | A tactile local-first hex island strategy game for humans and agents. | Settle a hex island with friends, or with Codex and Claude players running on their own machines. | `index.html` |
| `<title>` | Katan | Keep. | `index.html` |
| `.copyright-note`, bottom of `<main>` in `App` | Original prototype · base rules 2020 | Keep. | `src/App.tsx` |
| `GameScene` `<Canvas fallback=…>`, `.webgl-fallback` | This board needs WebGL. Your game state is safe; try a browser with hardware acceleration. | This board needs WebGL. Your game is safe where it is. Reopen it in a browser with hardware acceleration turned on. | `src/scene/GameScene.tsx` |
| `.sr-only.board-targets` group | `aria-label="Board targets"` | `aria-label="Places you can build"` | `src/App.tsx` |

### 3.2 Title screen (`Journey`, `stage === 'title'`)

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| `.title-kicker` | One island · humans and local agents | One island, shared by humans and agents | `src/ui/Journey.tsx` |
| `h1#game-title` | Katan | Keep. | `src/ui/Journey.tsx` |
| `.title-lede` | Create a private table, share its six-character code, and settle the same live island from any browser, Codex session, or Claude session. | Open a private table, share the six-character code, and settle one live island together. Seats can be browsers, or Codex and Claude sessions running on someone's own machine. | `src/ui/Journey.tsx` |
| `.title-actions` primary | Create room | Keep. | `src/ui/Journey.tsx` |
| `.title-actions` secondary | Join with code | Keep. | `src/ui/Journey.tsx` |
| `.title-foot` | No built-in bots. Every seat belongs to a real human or a local agent you invited. | No house bots. Every seat belongs to someone you invited, human or agent. | `src/ui/Journey.tsx` |

### 3.3 Create a room (`Journey`, `stage === 'create'`)

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| header kicker, `creating` branch | New expedition | A new crossing | `src/ui/Journey.tsx` |
| `h2#configure-title`, `creating` | Create a room | Keep. | `src/ui/Journey.tsx` |
| back button | `aria-label="Back to title"` | Keep. | `src/ui/Journey.tsx` |
| `.seat-count` group | `aria-label="Player count"` | `aria-label="Seats at the table"` | `src/ui/Journey.tsx` |
| seat buttons | `aria-label="3 players"` / `"4 players"` | `aria-label="Three seats"` / `"Four seats"` | `src/ui/Journey.tsx` |
| name label | Player name | Your name | `src/ui/Journey.tsx` |
| name placeholder | How the table will know you | The name the table will use | `src/ui/Journey.tsx` |
| `#board-panel-title` | Your island | Your island | `src/ui/Journey.tsx` |
| board panel `<small>` | This is the exact board you will play. Shuffle until you like it. | This is the island you will play. Shuffle until it looks worth settling. | `src/ui/Journey.tsx` |
| `.board-shuffle` | Shuffle | Keep. | `src/ui/Journey.tsx` |
| options disclosure | Options / Hide options | Keep. | `src/ui/Journey.tsx` |
| `.board-seed` label | Seed | Island number | `src/ui/Journey.tsx` |
| `#board-seed-note` | Share or type a seed to play the same island again. | Every island has a number. Keep this one to play the same island again. | `src/ui/Journey.tsx` |
| **new**, seed input rejected | *(silently clamped, nothing shown)* | Add, next to the field, on a rejected value: `A number from 0 to 4,294,967,295.` | `src/ui/Journey.tsx` |
| `#desert-label` | Desert | Keep. | `src/ui/Journey.tsx` |
| `desertChoices` | Anywhere / Centre / Coast | Anywhere / Center / Coast | `src/ui/Journey.tsx` |
| `#harbor-label` | Harbours | Harbors | `src/ui/Journey.tsx` |
| `harborChoices` | Shuffled / Classic | Shuffled / Classic | `src/ui/Journey.tsx` |
| `.board-toggle` label | Balance the pips, so no corner of the island is starved or overloaded | Balance the pips so no corner of the island is starved or overloaded | `src/ui/Journey.tsx` |
| `.board-rules` | Always enforced: no two identical terrains touch, no two identical numbers touch, 6 and 8 never touch, and 2 and 12 never touch. | Four rules survive every shuffle: no two matching terrains touch, no two matching numbers touch, 6 never touches 8, and 2 never touches 12. | `src/ui/Journey.tsx` |
| `.board-warning`, `boardRelaxed` includes `balancedPips` | This island could not be pip-balanced, so that setting was dropped for it. Shuffle for another. | The pips would not balance on this island, so that setting is off for this one. Shuffle again for a balanced island. | `src/ui/Journey.tsx` |
| `.room-form-note` strong, `creating` | `${seatsTotal}-seat table` | `Table for ${seatsTotal}` | `src/ui/Journey.tsx` |
| `.room-form-note` span, `creating` | You will be the host. Humans get a browser link; local Codex and Claude players get one command that installs and launches them. | You are the host. People join by link. Codex and Claude players join with one command you copy from the lobby. | `src/ui/Journey.tsx` |
| footer `<p>`, `creating` | You can start once every human or agent seat has joined. | You can start once every seat is filled. | `src/ui/Journey.tsx` |
| submit button | Create room / Opening the table… | Create room / Opening the table… | `src/ui/Journey.tsx` |

**On the board-rules line.** The panel has settings and guarantees side by side,
and the current sentence reads like a release note. "Four rules survive every
shuffle" does the work: it counts them so the eye knows when to stop, it makes
them a property of the island rather than a checkbox the host forgot, and
"survive every shuffle" answers the only question a host actually has, which is
whether pressing Shuffle can break them.

### 3.4 Join a room (`Journey`, `stage === 'join'`)

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| header kicker, `!creating` | Invitation in hand | Someone kept you a seat | `src/ui/Journey.tsx` |
| `h2#configure-title` | Join a room | Keep. | `src/ui/Journey.tsx` |
| room code label | Room code | Room code | `src/ui/Journey.tsx` |
| room code placeholder | ABC234 | Keep. | `src/ui/Journey.tsx` |
| `.room-form-note` strong, `!creating` | One shared island | One shared island | `src/ui/Journey.tsx` |
| `.room-form-note` span, `!creating` | Your cards stay private to this seat. The server sends every player only the state they are allowed to see. | Your hand is yours. The server sends each seat only what that seat is allowed to see. | `src/ui/Journey.tsx` |
| footer `<p>`, `!creating` | Codes are case-insensitive and never contain confusing characters like O, I, 0, or 1. | Codes ignore case, and never use O, I, 0 or 1. | `src/ui/Journey.tsx` |
| submit button | Join room / Opening the table… | Join room / Taking your seat… | `src/ui/Journey.tsx` |
| `.journey-error` | *(server message, see 3.11)* | | `src/ui/Journey.tsx` |

### 3.5 Lobby (`Journey`, `stage === 'lobby'`)

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| header kicker | Private room | Private room | `src/ui/Journey.tsx` |
| `h2#lobby-title` | Gather the table | Keep. It is the best line on the screen. | `src/ui/Journey.tsx` |
| back button | `aria-label="Leave room"` | Keep. | `src/ui/Journey.tsx` |
| `.connection-pill` | Live / Connecting | Live / Connecting | `src/ui/Journey.tsx` |
| room invite label | Room code | Keep. | `src/ui/Journey.tsx` |
| `.island-seed` | `Island seed ${room.boardSeed}` | `Island ${room.boardSeed}` | `src/ui/Journey.tsx` |
| copy code button | Copy code / Copied | Keep. | `src/ui/Journey.tsx` |
| copy link button | Copy human link / Copied | Copy invite link / Copied | `src/ui/Journey.tsx` |
| agent invite trigger | Invite an agent | Keep. | `src/ui/Journey.tsx` |
| seat card, `controller === 'agent'` | Live local agent | `Local agent` on line one, and the character line under it (`Harbour pilot. Trades early, trades often.`) | `src/ui/Journey.tsx` |
| seat card, own seat | You · browser player | You | `src/ui/Journey.tsx` |
| seat card, other human | Remote human | Joined by link | `src/ui/Journey.tsx` |
| seat meta badge | Host / Ready | Keep. | `src/ui/Journey.tsx` |
| empty seat strong | Open seat | Open seat | `src/ui/Journey.tsx` |
| empty seat small | Waiting for a human link or an agent command. | Nobody yet. Send the link, or the agent command. | `src/ui/Journey.tsx` |
| empty seat badge | Waiting | Open | `src/ui/Journey.tsx` |
| footer, full and host | Everyone is here. Start whenever the table is ready. | Everyone is aboard. Start when you are ready. | `src/ui/Journey.tsx` |
| footer, full and not host | The table is full. Waiting for the host to start. | Every seat is filled. The host starts the game. | `src/ui/Journey.tsx` |
| footer, seats open | `${n} seat${s} still open.` | Keep. | `src/ui/Journey.tsx` |
| start button | Start game | Keep. | `src/ui/Journey.tsx` |
| non-host waiting | Waiting for host | Waiting on the host | `src/ui/Journey.tsx` |

### 3.6 Agent invite dialog (`Journey`, `agentInviteOpen`)

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| header kicker | Live agent invitation | Live agent invitation | `src/ui/Journey.tsx` |
| `h3#agent-invite-title` | Bring your own player | Keep. | `src/ui/Journey.tsx` |
| close button | `aria-label="Close agent invitation"` | Keep. | `src/ui/Journey.tsx` |
| `.agent-invite-lede` | Paste one command into a terminal with a signed-in Codex or Claude CLI. It installs a versioned runner, claims one real seat, and sleeps between decisions. | Paste one command into a terminal running a signed-in Codex or Claude CLI. It claims a real seat, then wakes the model only when that seat has to decide. | `src/ui/Journey.tsx` |
| Codex step label | Codex | Keep. | `src/ui/Journey.tsx` |
| Codex `h4` | Launch a Codex player | Keep. | `src/ui/Journey.tsx` |
| Codex body | Requires Node 22.12+ and a signed-in current Codex CLI. The runner uses the flagship model, resumes one session, and enables only Katan MCP tools. | Needs Node 22.12 or newer and a signed-in Codex CLI. The runner uses the flagship model, keeps one session for the whole match, and enables only Katan tools. | `src/ui/Journey.tsx` |
| Codex button | Copy Codex command / Codex command copied | Keep. | `src/ui/Journey.tsx` |
| Claude step label | Claude Code | Keep. | `src/ui/Journey.tsx` |
| Claude `h4` | Launch a Claude player | Keep. | `src/ui/Journey.tsx` |
| Claude body | Requires Node 22.12+ and a signed-in Claude CLI. Built-in tools and customizations stay off; the same hosted rules and live turn stream drive the seat. | Needs Node 22.12 or newer and a signed-in Claude CLI. Built-in tools and customizations stay off. The seat runs on the same hosted rules and the same live turn stream as everyone else. | `src/ui/Journey.tsx` |
| Claude button | Copy Claude command / Claude command copied | Keep. | `src/ui/Journey.tsx` |
| `.agent-manual-copy` strong | Clipboard blocked | Copy blocked | `src/ui/Journey.tsx` |
| `.agent-manual-copy` span | Select and copy the command manually. | Your browser refused the clipboard. Select the command below and copy it. | `src/ui/Journey.tsx` |
| textarea labels | `aria-label="Katan Codex command"` / `"Katan Claude command"` | Keep. | `src/ui/Journey.tsx` |
| footer `<p>` | No model runs on the game server. The local runner keeps the seat key outside the model process, persists recovery state with owner-only permissions, and receives only that seat's private view. | No model runs on the game server. The runner on your machine holds the seat key outside the model, saves recovery state readable only by you, and receives only that seat's view. | `src/ui/Journey.tsx` |
| footer link | All clients & manual MCP ↗ | All clients and manual MCP ↗ | `src/ui/Journey.tsx` |

### 3.7 Introduction (`Journey`, `stage === 'introduction'`)

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| `.title-kicker` | The room is live | The room is live | `src/ui/Journey.tsx` |
| `h2#introduction-title` | First to 10 points wins | First to 10 points takes the island | `src/ui/Journey.tsx` |
| body `<p>` | Build two starting settlements and roads. Your second settlement collects one resource from each neighboring productive tile. | Place two settlements and two roads. Your second settlement collects one card from every producing tile it touches. | `src/ui/Journey.tsx` |
| turn order small, agent | Local agent | Local agent | `src/ui/Journey.tsx` |
| turn order small, human | Human | `You` for the viewer, `Player` for anyone else | `src/ui/Journey.tsx` |
| `.setup-rule` strong | Snake setup | Snake order | `src/ui/Journey.tsx` |
| `.setup-rule` span | The order reverses after everyone places once, so the final player places twice in a row. | The order reverses after the first round, so the last player places twice in a row. | `src/ui/Journey.tsx` |
| enter button | Enter the island | Go ashore | `src/ui/Journey.tsx` |

### 3.8 Turn panel, rail and coach (`Hud`)

**`phaseCopy`**

| Phase | Now | Should say |
| --- | --- | --- |
| `setup-settlement` | Place settlement | Place a settlement |
| `setup-road` | Place adjacent road | Place a road from it |
| `pre-roll` | Roll dice | Roll |
| `action` | Build · trade · cards | Build and trade |
| `discard` | Discard half | Discard half your hand |
| `move-robber` | Move robber | Move the robber |
| `choose-victim` | Choose rival | Pick who to rob |
| `road-building` | Place free roads | Two free roads |
| `year-of-plenty` | Choose two resources | Take two cards |
| `monopoly` | Choose one resource | Name a resource |
| `trade-response` | Trade waiting | Waiting on an answer |
| `game-over` | Match complete | Game over |

**Rest of the HUD**

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| `TurnPanel` `.turn-owner` small | Agent turn / Current turn | Thinking / Now playing | `src/ui/Hud.tsx` |
| `TurnPanel` dice | `aria-label={\`Last roll ${total}\`}` | `aria-label={\`Last roll, ${total}\`}` | `src/ui/Hud.tsx` |
| `suggestedLabel`, settlement | Place suggested settlement | Take the suggested spot | `src/ui/Hud.tsx` |
| `suggestedLabel`, road | Place suggested road | Take the suggested route | `src/ui/Hud.tsx` |
| `suggestedLabel`, city | Upgrade suggested city | Upgrade the suggested settlement | `src/ui/Hud.tsx` |
| `suggestedLabel`, robber | Move robber to suggested hex | Send the robber there | `src/ui/Hud.tsx` |
| `agentStatusCopy.idle` | Waiting | Waiting | `src/ui/Hud.tsx` |
| `agentStatusCopy.thinking` | Turn pending | Thinking | `src/ui/Hud.tsx` |
| `PlayerRail` aside | `aria-label="Players"` | `aria-label="At the table"` | `src/ui/Hud.tsx` |
| `PlayerRail` human small | Human | `You` for the viewer, `Player` for anyone else | `src/ui/Hud.tsx` |
| `PlayerRail` stats | `aria-label={\`${vp} victory points, ${n} resource cards, ${d} development cards, ${k} knights played\`}` | Prefix the player's name: `` `${player.name}: ${vp} victory points, ${n} cards in hand, ${d} development cards, ${k} knights played` ``. See bug 3. | `src/ui/Hud.tsx` |
| stat titles | Victory points / Resource cards / Development cards / Longest road / Largest army | Victory points / Cards in hand / Development cards / Longest Road / Largest Army | `src/ui/Hud.tsx` |
| `DiceMoment` | `aria-label={\`Rolled ${sum}\`}` | Keep. | `src/ui/Hud.tsx` |
| `.production-none` | No settlement produced | Nothing produced | `src/ui/Hud.tsx` |
| `AgentDecisionPreview` small | `Local agent · revision ${n}` | `Local agent` plus the character line. The revision number is developer instrumentation on a player screen. See bug 14. | `src/ui/Hud.tsx` |
| `AgentDecisionPreview` `<p>` | Choosing a move / Waiting for agent | Choosing a move / Waiting to act | `src/ui/Hud.tsx` |
| `ContextCoach` `setup-settlement` | Found your first outpost / Pick a corner touching productive numbers and a mix of resources. | Place your first settlement / Look for a corner touching three tiles, decent numbers, and resources you do not already have. | `src/ui/Hud.tsx` |
| `ContextCoach` `setup-road` | Point toward your expansion / Your road must touch the settlement you just placed. | Point somewhere worth going / The road has to start at the settlement you just placed. | `src/ui/Hud.tsx` |
| `ContextCoach` `discard` | A seven was rolled / Hands above seven discard half before the robber moves. | Seven / Anyone holding more than seven cards discards half before the robber moves. | `src/ui/Hud.tsx` |
| `ContextCoach` `move-robber` | Block a rival tile / The robber stops production there and may let you steal from an adjacent rival. | Pick a tile to shut down / It stops producing, and you take one card from someone built beside it. | `src/ui/Hud.tsx` |
| `ContextCoach` `choose-victim` | Choose one adjacent rival / You steal one random resource without seeing their hand. | Pick one of them / You take one card at random, without seeing the hand. | `src/ui/Hud.tsx` |
| `ContextCoach` `road-building` | Road Building is active / Place up to two free roads, or finish early. | Road Building / Two free roads. Place both, or finish early. | `src/ui/Hud.tsx` |
| `ContextCoach` `year-of-plenty` | Year of Plenty is active / Take any two cards the bank can still supply. | Year of Plenty / Take any two cards the bank can still supply. | `src/ui/Hud.tsx` |
| `ContextCoach` `monopoly` | Monopoly is active / Name one resource; every rival gives you all of that type. | Monopoly / Name a resource. Every other player hands you all of theirs. | `src/ui/Hud.tsx` |
| `ContextCoach` `trade-response` | A trade is waiting / Accept, decline, or send a counteroffer without revealing your hand. | A trade is waiting / Accept, decline, or counter. Nothing about your hand is revealed either way. | `src/ui/Hud.tsx` |
| **new** `ContextCoach`, offerer during `trade-response` | *(nothing)* | Add: `Offer sent` / `` `Waiting on ${target.name}.` ``. See bug 10. | `src/ui/Hud.tsx` |

### 3.9 Action tray, wallet, previews (`Hud`)

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| `ResourceWallet` section | `aria-label="Your resources"` | `aria-label="Your hand"` | `src/ui/Hud.tsx` |
| wallet development button | small `Cards`, `title="Open development cards"`, `aria-label={\`Development cards, ${n} held\`}` | small `Cards`, `title="Your development cards"`, `aria-label={\`Development cards, ${n} in hand\`}` | `src/ui/Hud.tsx` |
| `RESOURCE_LABEL` | Brick / Lumber / Ore / Grain / Wool | Keep. These are the rulebook's words. | `src/ui/gameVisuals.ts` |
| `BUILD_COMMANDS` labels | Road / Settle / City | Road / Settlement / City. "Settle" is a verb sitting between two nouns. | `src/ui/Hud.tsx` |
| build command | `aria-label={\`${label}, ${choices} legal locations\`}` | When `choices > 0`: `` `${label}: ${choices} places you can build` ``. When `choices === 0` and the hand cannot cover the cost: `` `${label}: you cannot afford it yet` ``. When `choices === 0` and the hand can: `` `${label}: nowhere legal to build` ``. See bug 6. | `src/ui/Hud.tsx` |
| develop command | `<span>Develop</span>`, `aria-label={\`Buy development card, ${n} remain\`}` | `<span>Card</span>`, `aria-label={\`Buy a development card, ${n} left in the deck\`}` | `src/ui/Hud.tsx` |
| turn rail | Roll / Trade / Cards / End / Finish | Roll / Trade / Cards / End turn / Finish | `src/ui/Hud.tsx` |
| tray nav | `aria-label="Turn actions"` | Keep. | `src/ui/Hud.tsx` |
| build rail | `aria-label="Build"` | Keep. | `src/ui/Hud.tsx` |
| `actionLabel['place-settlement']` | Settlement founded | Settlement founded | `src/ui/Hud.tsx` |
| `actionLabel['place-road']` | Road laid | Road laid | `src/ui/Hud.tsx` |
| `actionLabel['build-settlement']` | Settlement built | Settlement built | `src/ui/Hud.tsx` |
| `actionLabel['build-road']` | Road built | Road built | `src/ui/Hud.tsx` |
| `actionLabel['build-city']` | City raised | City raised | `src/ui/Hud.tsx` |
| `actionLabel['buy-development']` | Development card bought | Card bought | `src/ui/Hud.tsx` |
| `actionLabel['maritime-trade']` | Harbor trade complete | Traded at the harbor | `src/ui/Hud.tsx` |
| `actionLabel['offer-trade']` | Trade offered | Offer sent | `src/ui/Hud.tsx` |
| `actionLabel['counter-trade']` | Counteroffer made | Counteroffer sent | `src/ui/Hud.tsx` |
| `actionLabel['respond-trade']` | Trade answered | Trade answered | `src/ui/Hud.tsx` |
| `actionLabel['move-robber']` | Robber moved | Robber moved | `src/ui/Hud.tsx` |
| `actionLabel['end-turn']` | Turn passed | Turn ended | `src/ui/Hud.tsx` |
| `TransitionMoment` card reveal | Development played / Mystery card | Card played / Card drawn | `src/ui/Hud.tsx` |
| `actionPreviewCopy` settlement | Found this settlement? / Confirm the glowing corner or choose another. | Found this settlement? / Confirm the glowing corner, or pick another. | `src/ui/Hud.tsx` |
| `actionPreviewCopy` city | Raise this city? / The selected settlement will become a two-point city. | Raise this city? / This settlement becomes a city worth two points. | `src/ui/Hud.tsx` |
| `actionPreviewCopy` road | Lay this road? / Confirm the highlighted route or choose another. | Build this road? / Confirm the highlighted route, or pick another. | `src/ui/Hud.tsx` |
| `actionPreviewCopy` robber | Move the robber here? / This tile will stop producing until the robber moves again. | Move the robber here? / This tile stops producing until the robber moves on. | `src/ui/Hud.tsx` |
| `ActionPreview` buttons | Cancel / Confirm | Keep. | `src/ui/Hud.tsx` |
| history button | `title="Match history"`, `aria-label="Open match history and controller status"` | `title="Match log"`, `aria-label="Open the match log"` | `src/ui/Hud.tsx` |
| sound button | `title`/`aria-label` `Turn sound on` / `Mute sound` | Keep. | `src/ui/Hud.tsx` |
| rules button | `title="Rules"`, `aria-label="Open the rules"` | Keep. | `src/ui/Hud.tsx` |
| home button | `title="Leave this match"`, `aria-label="Leave this match and return to the menu"` | `title="Leave the table"`, `aria-label="Leave this match and return to the title screen"` | `src/ui/Hud.tsx` |

### 3.10 Dialogs

**Trade table**

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| modal title | Trade table | Keep. | `src/ui/Dialogs.tsx` |
| maritime `h3` | Harbor | Harbor | `src/ui/Dialogs.tsx` |
| `.public-stack` title | Best available exchange rate | Your best rate | `src/ui/Dialogs.tsx` |
| `ResourcePicker` legends | Give / Receive | Give / Get | `src/ui/Dialogs.tsx` |
| `.ratio-picker` | `aria-label="Exchange rate"` | Keep. | `src/ui/Dialogs.tsx` |
| maritime primary, enabled | `Exchange ${ratio} for 1` | Keep. | `src/ui/Dialogs.tsx` |
| maritime primary, disabled | Unavailable | Pick two different resources | `src/ui/Dialogs.tsx` |
| `HarborRates` `<dt>` | Your bank rates | Your bank rates | `src/ui/Dialogs.tsx` |
| domestic `h3` | Player trade | Trade with a player | `src/ui/Dialogs.tsx` |
| `.privacy-mark` | Hidden hands, `title="Only public card totals are visible"` | Hands stay hidden, `title="Only public totals are visible"` | `src/ui/Dialogs.tsx` |
| partner group | `aria-label="Trade partner"` | Keep. | `src/ui/Dialogs.tsx` |
| `TradeBundle` titles | You give / You ask | You give / You want | `src/ui/Dialogs.tsx` |
| `TradeBundle` stepper aria | `Remove ${resource} from ${title}` / `Add ${resource} to ${title}` | Keep. | `src/ui/Dialogs.tsx` |
| `.trade-warning` | A resource cannot appear on both sides. | You cannot ask for what you are giving. | `src/ui/Dialogs.tsx` |
| `TradeSummary` empty | Stage what you give and what you ask. | Set what you give and what you want. | `src/ui/Dialogs.tsx` |
| `TradeSummary` `<em>` | nothing | nothing | `src/ui/Dialogs.tsx` |
| `.trade-reset` | Clear offer | Clear offer | `src/ui/Dialogs.tsx` |
| domestic primary, enabled | Send offer | Keep. | `src/ui/Dialogs.tsx` |
| domestic primary, disabled | Choose what to trade | Put something on both sides | `src/ui/Dialogs.tsx` |

**Trade response**

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| modal title | `${from.name} offers a trade` | Keep. | `src/ui/Dialogs.tsx` |
| `VisualTradeBundle` | You receive / You give | You get / You give | `src/ui/Dialogs.tsx` |
| buttons | Decline / Accept trade | Decline / Accept | `src/ui/Dialogs.tsx` |
| counter section | Counter | Counter with | `src/ui/Dialogs.tsx` |
| counter bundles | You give / You ask | You give / You want | `src/ui/Dialogs.tsx` |
| counter button | `Offer ${giveTotal} ↔ ${receiveTotal}` | Send counteroffer | `src/ui/Dialogs.tsx` |
| **new**, no takers | *(nothing)* | Toast after every recipient declines: `No takers.` See bug 10. | `src/ui/Hud.tsx` |

**Development hand**

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| modal title | Development hand | Development hand | `src/ui/Dialogs.tsx` |
| `DEVELOPMENT_NAME.knight` | Knight | Knight | `src/ui/gameVisuals.ts` |
| `DEVELOPMENT_SHORT.knight` | Move robber · steal 1 | Move the robber, take a card, and add one to your army. | `src/ui/gameVisuals.ts` |
| `DEVELOPMENT_NAME['road-building']` | Road Building | Road Building | `src/ui/gameVisuals.ts` |
| `DEVELOPMENT_SHORT['road-building']` | Place 2 free roads | Two roads, free, anywhere they legally fit. | `src/ui/gameVisuals.ts` |
| `DEVELOPMENT_NAME['year-of-plenty']` | Year of Plenty | Year of Plenty | `src/ui/gameVisuals.ts` |
| `DEVELOPMENT_SHORT['year-of-plenty']` | Take any 2 | Any two cards, straight from the bank. | `src/ui/gameVisuals.ts` |
| `DEVELOPMENT_NAME.monopoly` | Monopoly | Monopoly | `src/ui/gameVisuals.ts` |
| `DEVELOPMENT_SHORT.monopoly` | Claim one resource | Name a resource. Every other player hands you all of theirs. | `src/ui/gameVisuals.ts` |
| `DEVELOPMENT_NAME['victory-point']` | Victory Point | Victory Point | `src/ui/gameVisuals.ts` |
| `DEVELOPMENT_SHORT['victory-point']` | Hidden point | One point, kept secret until the game is won. | `src/ui/gameVisuals.ts` |
| card count | `aria-label={\`${count} owned\`}` | `aria-label={\`${count} in hand\`}` | `src/ui/Dialogs.tsx` |
| victory-point held | Keep hidden | Stays hidden | `src/ui/Dialogs.tsx` |
| play button | Play | Keep. | `src/ui/Dialogs.tsx` |
| `.modal-note` | You have already played a development card this turn. | One card per turn. This one waits until next turn. | `src/ui/Dialogs.tsx` |

**Discard, choices, victory**

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| discard title | `Discard ${required}` | `` `Discard ${required} cards` `` | `src/ui/Dialogs.tsx` |
| discard bundle legend | Choose cards | Choose what goes | `src/ui/Dialogs.tsx` |
| discard button, ready | `Discard ${total} / ${required}` | `` `Discard ${required}` `` | `src/ui/Dialogs.tsx` |
| discard button, short | `Discard ${total} / ${required}` (disabled, silent) | `` `Choose ${required - total} more` ``. See bug 11. | `src/ui/Dialogs.tsx` |
| choose-victim title | Choose a rival | Rob one of them | `src/ui/Dialogs.tsx` |
| **new** choose-victim body | *(nothing)* | Add: `You take one card at random. You will not see the rest of the hand.` | `src/ui/Dialogs.tsx` |
| year-of-plenty title | Year of Plenty | Keep. | `src/ui/Dialogs.tsx` |
| year-of-plenty slots | `aria-label="Chosen resources"` | `aria-label="Your two picks"` | `src/ui/Dialogs.tsx` |
| year-of-plenty button | Take selected pair | Take these two | `src/ui/Dialogs.tsx` |
| monopoly title | Monopoly | Keep. | `src/ui/Dialogs.tsx` |
| **new** monopoly body | *(nothing at all, just a grid)* | Add above the grid: `Name a resource. Every other player hands you all of theirs.` | `src/ui/Dialogs.tsx` |
| game-over title | `${winner.name} wins` | `` `${winner.name} takes the island` ``, or `You take the island` when the winner is the viewer | `src/ui/Dialogs.tsx` |
| `.victory-copy` | The island recognizes a new steward with **N victory points**. | `` `Ten points reached on ${winner.name}'s own turn. Final score, ${n}.` `` Simplest correct version: `` `${winner.name} finished on ${n} victory points.` `` | `src/ui/Dialogs.tsx` |
| **new** game-over dismiss | *(no button, locked modal, no escape)* | Add a single button: `See the standings`. See bug 8. | `src/ui/Dialogs.tsx` |

**Rules**

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| modal title | Base rules | Base rules | `src/ui/Dialogs.tsx` |
| `h3` | Your turn | Keep, and the four numbered steps. | `src/ui/Dialogs.tsx` |
| `h3` | Build costs | Keep, and the four cost lines. | `src/ui/Dialogs.tsx` |
| `h3` | Seven and the robber | Keep the heading and the paragraph. | `src/ui/Dialogs.tsx` |
| `h3` | Victory | Keep the heading and the paragraph. | `src/ui/Dialogs.tsx` |
| `.modal-note` | Rules follow the attached 2020 fifth-edition base-game rulebook. The advanced combined trade/build phase is enabled. | Base game, 2020 fifth edition. Trading and building share one phase. | `src/ui/Dialogs.tsx` |

**Match log**

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| modal title | Match history | Match log | `src/ui/Dialogs.tsx` |
| left `h3` | Controllers | At the table | `src/ui/Dialogs.tsx` |
| agent seat small | `Local agent seat${' · turn pending'}` | `` `Local agent${thinking ? ', thinking' : ''}` ``, with the character line beneath | `src/ui/Dialogs.tsx` |
| human small | Human player | `You` for the viewer, `Player` for anyone else | `src/ui/Dialogs.tsx` |
| right `h3` | Public timeline | What happened | `src/ui/Dialogs.tsx` |
| modal close | `aria-label="Close"` | Keep. | `src/ui/Dialogs.tsx` |

### 3.11 Summary (`Journey`, `stage === 'summary'`)

| Locator | Now | Should say | File |
| --- | --- | --- | --- |
| `.title-kicker` | The final bell has rung | The island is settled | `src/ui/Journey.tsx` |
| `h2#summary-title`, viewer won | You win the island | Keep. No exclamation mark. It does not need one. | `src/ui/Journey.tsx` |
| `h2#summary-title`, someone else | `${winner.name} wins the island` | Keep. | `src/ui/Journey.tsx` |
| body `<p>` | `${n} victory points secured the crown.` | `` `Won on ${n} victory points.` `` | `src/ui/Journey.tsx` |
| standings small, agent | Local agent | Local agent | `src/ui/Journey.tsx` |
| standings small, human | Human | `You` for the viewer, `Player` for anyone else | `src/ui/Journey.tsx` |
| standings score | `${n} VP` | Keep. | `src/ui/Journey.tsx` |
| award chips | Longest road / Largest army | Longest Road / Largest Army | `src/ui/Journey.tsx` |
| `.summary-events` strong | Closing moments | Keep. It is doing real work. | `src/ui/Journey.tsx` |
| leave button | Leave table | Leave the table | `src/ui/Journey.tsx` |
| rematch button | Start rematch | Play again | `src/ui/Journey.tsx` |
| non-host waiting | Waiting for the host | The host calls the rematch. | `src/ui/Journey.tsx` |

### 3.12 Game narration (`src/game/engine.ts`, `addEvent`)

These are the log lines that appear in the match log, in the transition moment
under the action label, and in "Closing moments" on the summary screen. They are
the largest single block of the game's voice and are mostly good already.

| Now | Should say |
| --- | --- |
| `${name} rolled highest and places first.` | Keep. |
| `${name} founded a settlement.` | Keep. |
| `${name} laid a road.` | Keep. |
| `You take the first turn.` / `${name} takes the first turn.` | Keep. |
| `${name} rolled ${total}.` | Keep. |
| `The island produced for ${total}.` | Keep. Best line in the file. |
| `${name} discarded ${amount} cards.` | Keep. |
| `${name} moved the robber.` | Keep. |
| `${name} stole a resource from ${victim}.` | `` `${name} took a card from ${victim}.` `` The thief does not learn which resource, so the log should not imply the table did. |
| `${victim} had no resource cards to steal.` | `` `${victim} had nothing to take.` `` |
| `${name} built a road.` | Keep. |
| `${name} built a settlement.` | Keep. |
| `${name} raised a city.` | Keep. |
| `${name} bought a development card.` | `` `${name} bought a card.` `` |
| `${name} played ${action.card.replaceAll('-', ' ')}.` | `` `${name} played ${DEVELOPMENT_NAME[action.card]}.` `` Currently renders "played year of plenty." See bug 1. |
| `${name} drew two resources.` | `` `${name} took two cards from the bank.` `` |
| `${name} claimed ${amount} ${resource}.` | `` `${name} claimed every ${resource} on the table, ${amount} cards.` `` |
| `${name} traded ${ratio} ${give} for ${receive}.` | `` `${name} traded ${ratio} ${give} for 1 ${receive} at the harbor.` `` |
| `${name} finished placing free roads.` | Keep. |
| `${name} offered a trade to ${other}.` | Keep. |
| `${name} accepted ${other}'s trade.` / `declined` | Keep. |
| `${name} made a counteroffer to ${other}.` | Keep. |
| `Your turn begins.` / `${name}'s turn begins.` | Keep. |
| `${name} settled the island with ${score} points.` | Keep. |
| `${name} now holds Longest Road` (`useGame.ts` `awardChanges`) | `` `Longest Road passes to ${name}` ``, and `` `Longest Road is unclaimed` `` when nobody holds it. Currently renders "No one now holds Longest Road". |
| `${name} now holds Largest Army` | `` `Largest Army passes to ${name}` ``, and `Largest Army is unclaimed` for the empty case. |

### 3.13 Engine refusals (`src/game/engine.ts`, `fail`)

Surfaced as the red toast in the HUD, `role="alert"`. This is where tone matters
most because the player already knows something went wrong.

| Now | Should say |
| --- | --- |
| That starting settlement is not legal | Settlements need two edges of space. Pick a corner further out. |
| That starting road is not legal | The road has to start at the settlement you just placed. |
| Roll at the start of your turn | Roll the dice first. |
| You do not need to discard now | Nothing to discard right now. |
| `Discard exactly ${required} resource cards` | `` `Discard exactly ${required} cards, no more and no fewer.` `` |
| Move the robber to a different hex | The robber has to go somewhere new. |
| Choose an adjacent player | Pick someone built beside that tile. |
| That player is unavailable | That seat is gone. |
| That road is not legal | Roads must connect to your own road or settlement. |
| A road costs brick and lumber | A road costs 1 brick and 1 lumber. |
| That settlement is not legal or affordable | Split it. Placement: `Settlements need two edges of space, and a road of yours reaching the corner.` Cost: `A settlement costs 1 brick, 1 lumber, 1 grain and 1 wool.` See bug 5. |
| Upgrade one of your settlements with 3 ore and 2 grain | Keep. This one is already right. |
| A development card costs ore, wool, and grain | Split it. Cost: `A card costs 1 ore, 1 wool and 1 grain.` Deck empty: `The development deck is empty.` See bug 4. |
| That development card cannot be played now | One development card per turn, and never on the turn you bought it. |
| The bank cannot supply two resources | The bank is down to its last card. |
| Year of Plenty is not active | Year of Plenty is not in play. |
| The bank cannot supply those resources | The bank cannot cover both of those. Pick again. |
| Monopoly is not active | Monopoly is not in play. |
| That maritime trade is unavailable | You need the full stack to give, and the bank needs one to hand back. |
| Road Building is not active | Road Building is not in play. |
| Place both free roads while legal paths remain | Road Building gives you two. Place the second one. |
| That domestic trade is invalid | Put at least one card on each side of the offer. |
| You lack the cards in that offer | You do not hold everything in that offer. |
| A resource cannot be traded for itself | You cannot ask for what you are giving. |
| There is no trade for you to answer | No trade is waiting on you. |
| The offering player is unavailable | The other seat is gone. The offer is dead. |
| A trader no longer has those cards | One of you no longer holds those cards. The offer is dead. |
| That counteroffer is invalid | Put at least one card on each side of the counteroffer. |
| You lack the cards in that counteroffer | You do not hold everything in that counteroffer. |
| Finish resolving the current action first | Finish what you started before ending the turn. |
| That action is not available now | You cannot do that right now. |
| No player can act right now | Nobody can act. Your view is out of step with the room, and it will resync. |
| Restart is only available after the game ends | A rematch waits until this game ends. |
| Base game requires 3 or 4 players (`throw`) | Developer-facing. Keep. |
| Unknown player (`throw`) | Developer-facing. Keep. |

### 3.14 Server refusals (`server/room-service.ts`, `server/realtime-server.ts`)

These reach the player through `.journey-error` on the create and join screens
and through the HUD toast in a match.

| Now | Should say | File |
| --- | --- | --- |
| That room does not exist or has expired. | No room with that code. Check the six characters, or ask the host for a fresh code. | `room-service.ts` |
| The room changed too quickly. Read the latest state and try again. | The room moved while that was in flight. Try again. | `room-service.ts` |
| This seat token is invalid. | This seat is no longer yours. Rejoin with the room code. | `room-service.ts` |
| Too many room requests. Wait a moment and try again. | Too many requests. Wait a few seconds and try again. | `room-service.ts` |
| Enter a player name. | Keep. Already right. | `room-service.ts` |
| Choose a three or four player room. | Tables seat three or four. | `room-service.ts` |
| A board seed must be a whole number between 0 and 4294967295. | An island number is a whole number from 0 to 4,294,967,295. | `room-service.ts` |
| Could not reserve a room code. Try again. | Could not reserve a code. Try again. | `room-service.ts` |
| Choose a human or agent seat. | Keep. | `room-service.ts` |
| Only a local agent runner may propose a recoverable seat credential. | Agent-facing. Keep. | `room-service.ts` |
| That recovery identity is already bound to another seat credential. | Agent-facing. Keep. | `room-service.ts` |
| That recovery identity belongs to a different seat. | Agent-facing. Keep. | `room-service.ts` |
| That game has already started. | That game already started. Ask the host to open a new room. | `room-service.ts` |
| That room is full. | Every seat in that room is taken. | `room-service.ts` |
| **Only the room host can start the game.** | Only the host can start. They are looking at the same lobby you are. | `room-service.ts` |
| The game is already running. | Keep. | `room-service.ts` |
| **Fill every seat before starting.** | `` `${open} seat${s} still open. Send the invite link, or the agent command from the lobby.` `` The service knows the count. See bug 7. | `room-service.ts` |
| This game is not running. | That game is not running. | `room-service.ts` |
| The room advanced before that action arrived. | Someone moved first. Your view has caught up, so try again. | `room-service.ts` |
| Another seat must act first. | It is not your turn yet. | `room-service.ts` |
| That action is not legal in the current position. | That move is not legal here. | `room-service.ts` |
| REDIS_URL is required when Katan runs on Vercel. | Operator-facing. Keep. | `room-service.ts` |
| The room service could not complete that request. | The room could not handle that. Try again. | `realtime-server.ts` |
| The request is too large. | Keep. | `realtime-server.ts` |
| Send a JSON object. / Send a JSON message. / Send a valid room message. / Unknown room message. | Developer-facing. Keep. | `realtime-server.ts` |
| Route not found. | Keep. | `realtime-server.ts` |
| Too many socket connections. | Keep. | `realtime-server.ts` |
| Authenticate the seat first. / This socket already owns a seat. | Developer-facing. Keep. | `realtime-server.ts` |
| Could not join the room. | Could not take that seat. | `realtime-server.ts` |
| The room command failed. | The room could not run that. Your game is safe. | `realtime-server.ts` |
| Socket close reasons: Seat expired / Rate limited / Authentication timeout / Hello required / Invalid seat / Room command failed | Never rendered. Keep. | `realtime-server.ts` |
| The explicit playerKey does not match this runner seat. / Pass the playerKey from join_room, or use the live runner. / The live runner already owns a seat. Use get_view instead of joining again. / invalid Origin messages | Agent and developer facing. Keep. | `hosted-mcp.ts` |

### 3.15 Client connection copy (`src/game/useGame.ts`, `src/App.tsx`)

| Now | Should say | File |
| --- | --- | --- |
| The room request failed. | The room did not answer. Try again. | `useGame.ts` |
| The room sent an unreadable update. Reconnecting… | Lost the thread of the room. Reconnecting. | `useGame.ts` |
| Could not create the room. | Keep. | `useGame.ts` |
| Could not join the room. | Keep. | `useGame.ts` |
| The room is reconnecting. Your move was not sent. | Still reconnecting. That move did not go through, so try it again in a second. | `useGame.ts` |
| `agentStatuses` detail `Waiting for a local agent action` | Deciding | `useGame.ts` |
| `agentStatuses` detail `Agent seat` | Local agent | `useGame.ts` |
| `hudError` `Reconnecting to the room…` | Reconnecting… | `App.tsx` |
| `hudError` `Connecting to the room…` | Connecting… | `App.tsx` |

### 3.16 Screen-reader board targets (`App.tsx`, `describeBoardAction`)

The hidden button list is the entire keyboard and screen-reader path to the
board, so it is real copy.

| Now | Should say |
| --- | --- |
| `terrainName` maps only `lumber → forest` and `wool → pasture` | Map all six: `brick → hills`, `lumber → forest`, `ore → mountains`, `grain → fields`, `wool → pasture`, `desert → desert`. A player currently hears "forest 8, brick 6" in one sentence. See bug 2. |
| `place settlement beside …` | `Found a settlement beside …` |
| `build settlement beside …` | `Build a settlement beside …` |
| `place road between …` / `build road between …` | `Lay a road between …` / `Build a road between …` |
| `move robber to …` | `Move the robber to …` |
| `… at the ${sector}, option ${n} of ${total}` | Keep. The sector words (`center`, `north-east`, and so on) are good. |
| `… to another tile` fallback | `… to an unnamed tile` |

---

## 4. Meta-comment inventory

Classified delete, rewrite or keep. Replacement text is given for every rewrite.
Line numbers are from the July 26 working tree and will drift.

### Delete outright

| File | Line | Text | Why |
| --- | --- | --- | --- |
| `src/styles.css` | 906 | `/* Owned by the board/pieces layer — keep intact. */` | Pure ownership. Says nothing about the CSS. |
| `src/scene/structures/PiecesLab.tsx` | 23-25 | `// Standalone review route for the pieces I own (/pieces-lab.html). The main board is being rebuilt by other agents, so this gives a stable stage with the same lighting recipe to grade silhouettes and materials against the refs.` | First person, ownership, and a claim about who is doing what this week. Replace with: `// Standalone stage for the game pieces at /pieces-lab.html, lit with the same recipe as the board.` |
| `src/scene/motion/placement.ts` | 9-11 (partial) | `Not owned by this file's author's scope today:` … `— see the handoff note in the motion report.` | Delete both fragments. Keep the fact underneath, see the rewrite row below. |
| `src/scene/loading/FrameStats.tsx` | 65-67 | `Every render defect found in this scene so far needed exactly this: drop a probe mesh in, A/B a light, read a uniform. The shadow bug was diagnosed in four steps through this handle after two sessions of static reading.` | A session diary. The first two sentences of the same block are worth keeping. |
| `src/scene/playerColors.ts` | 11-13 (partial) | `which a blind art director called the loudest placeholder signal in the frame` | Review process. The decision it produced is worth keeping, see the rewrite row. |
| `src/scene/structures/PiecesLab.tsx` | 235 (partial) | `wastes a screenshot every time` and `so a change is graded against the same six joints every pass` | Review workflow. The rig's purpose survives without it. |
| `src/App.tsx` | 99 (partial) | `The old call passed \`stage === 'summary'\` as "victorious", so the fanfare played at everyone who reached the end screen, winner or not.` | Changelog framing. The constraint survives as a statement, see the rewrite row. |

### Rewrite

| File | Line | Now | Replacement |
| --- | --- | --- | --- |
| `src/scene/BoardLab.tsx` | 7-8 | `// ponytail: visual-QA-only route (?board). Renders the island with no UI chrome` / `// so screenshot agents get a deterministic frame to grade against art/reference.` | `// The ?board route renders the island alone, with no UI chrome, for capturing reference frames.` |
| `src/scene/BoardLab.tsx` | 14-15 | `// Board generation options are readable from the query string so a QA frame can pin any` / `// island: ?desert=center&harbors=fixed&pips=0.` | `// Board options come from the query string, so one URL pins one island:` / `// ?desert=center&harbors=fixed&pips=0.` |
| `src/scene/motion/demo.ts` | 5-10 | `// Motion-QA-only driver, in the same spirit as the ?board route.` … `// a recording actually captures the arc. It is inert without the parameter.` | `// Camera easing, dice tumble and impact timing cannot be judged from a still of an` / `// idle board, and this route has no server to produce real events. ?motion=<beat>` / `// replays one beat on a loop. Inert without the parameter.` |
| `src/scene/motion/demo.ts` | 36 | `/** \`?motionPeriod=0\` stops the loop so a harness can step beats by hand. */` | `/** ?motionPeriod=0 stops the loop so beats can be stepped by hand. */` |
| `src/scene/motion/placement.ts` | 7-12 | whole block | `// Arrival physics for board pieces. The timing lives here rather than in the piece` / `// components so every piece falls on one curve.` / `//` / `// Pieces.tsx has not been switched over yet: it still damps its own scale from 0.08 to 1.` |
| `src/scene/motion/spring.ts` | 48-52 | `Global time scale for effect clocks. Always 1 unless \`?motionSpeed=\` is set on the visual-QA route — a 0.4s dust puff cannot be graded from a screenshot tool with a half-second round trip, so QA can run the same curves slowly.` | `/**` / ` * Global time scale for effect clocks. Always 1 unless ?motionSpeed= is set, which` / ` * runs every curve slowly so short effects can be watched instead of guessed at.` / ` */` |
| `src/scene/CameraRig.tsx` | 87-89 | `// Motion QA needs the actual easing curve, not a guess from screenshots. With` / `// \`?motion=…\` the rig publishes its spherical framing and frame time so a` / `// harness can read overshoot, settle time and fps as numbers. Off otherwise.` | `// Under ?motion=…, the rig publishes its spherical framing and frame time, so` / `// overshoot, settle time and fps can be read as numbers rather than eyeballed.` / `// Off otherwise.` |
| `src/scene/CameraRig.tsx` | 113 | `/** Let the QA harness walk the live scene graph, only under \`?motion=\`. */` | `/** Exposes the live scene graph for inspection, only under ?motion=. */` |
| `src/scene/structures/piecesLabEntry.tsx` | 4-6 | `// Entry for /pieces-lab.html — a visual-QA-only stage for the game pieces.` / `// \`?harbor\` swaps to the harbour rig over water, \`?net\` to the road-network` / `// legibility harness on the real island, \`?joins\` to the road junction rig.` | `// Entry for /pieces-lab.html. ?harbor shows the harbor rig over water, ?net the` / `// road network on the real island, ?joins the road junction rig.` |
| `src/scene/structures/PiecesLab.tsx` | 132-139 | `Road-network legibility harness (\`/pieces-lab.html?net=1\`).` … `so the answer is honest.` | `/**` / ` * Road network view (/pieces-lab.html?net=1).` / ` *` / ` * The ?board route only ever shows the six setup roads, which cannot answer the` / ` * question that matters: can you trace one player's route across a busy island at a` / ` * glance? This grows three long contiguous chains over the real terrain, real` / ` * lighting and the real game camera.` / ` */` |
| `src/scene/structures/PiecesLab.tsx` | 231-238 | `Junction rig (\`/pieces-lab.html?joins=1\`).` … `every pass.` | `/**` / ` * Junction rig (/pieces-lab.html?joins=1).` / ` *` / ` * Road joinery is a defect measured in centimetres, and the cases are scattered` / ` * across a real island. This lays out every junction that exists (three-way and` / ` * bend, single owner and mixed, plus a dead end) on one flat, evenly lit stage at a` / ` * fixed close camera.` / ` */` |
| `src/scene/ActionEffects.tsx` | 427-428 | `// \`?motion=<beat>\` on the visual-QA route replays one beat on a loop. Inert` / `// without the parameter, so real games are untouched.` | `// ?motion=<beat> replays one beat on a loop. Inert without the parameter, so real` / `// games are untouched.` |
| `src/App.tsx` | 21-26 | `Dev-only visual harness. \`?ui=<stage>\` on the Vite dev server drives the interface into a state that normally needs live opponents, so HUD, dialog and summary work can be screenshotted. Stripped from production builds by the \`import.meta.env.DEV\` guard and never reachable from the shipped app.` | `/**` / ` * ?ui=<stage> on the dev server drives the interface into a state that normally` / ` * needs live opponents. The import.meta.env.DEV guard strips it from production` / ` * builds, so it is never reachable from the shipped app.` / ` */` |
| `src/App.tsx` | 38 | `// Deterministic source so the harness renders the same state on every load.` | `// Deterministic source, so the preview renders the same state on every load.` |
| `src/App.tsx` | 99-102 | whole block | `// Victory and defeat are separate signals. Passing the summary stage alone as` / `// "victorious" plays the fanfare at the loser too. The stage also selects the` / `// ambience bed: the lobby sits at the dock, the match is out on the water.` |
| `src/scene/loading/FrameStats.tsx` | 43-47 | `Shadow wiring, because "the scene looks flat" has two very different causes and they are indistinguishable from a screenshot: a light that is not casting, or geometry that is not receiving.` | `/**` / ` * Shadow wiring, because "the scene looks flat" has two causes that look identical` / ` * in a still: a light that is not casting, or geometry that is not receiving.` / ` */` |
| `src/scene/loading/FrameStats.tsx` | 60-68 | whole block | `/**` / ` * Live handles on the renderer and the scene graph.` / ` *` / ` * React Three Fiber keeps both entirely inside React, so from a devtools console` / ` * there is otherwise no way to reach them.` / ` */` |
| `src/scene/ocean/oceanConfig.ts` | 17-18 | `// Radius of the ocean disc. Fog swallows it long before this, but a large` / `// disc keeps a believable horizon if the sky owner opens the fog up.` | `// Radius of the ocean disc. Fog swallows it long before this, but the extra radius` / `// keeps a believable horizon if the fog is ever opened up.` |
| `src/scene/motion/AmbientLife.tsx` | 148-149 | `Leaves and seed fluff running downwind across the island. The authored trees are static geometry we do not own, so the wind is shown by what it carries.` | `/**` / ` * Leaves and seed fluff running downwind across the island. The trees are static` / ` * geometry, so the wind is shown by what it carries rather than by what it moves.` / ` */` |
| `src/scene/playerColors.ts` | 10-18 | whole block | `/**` / ` * Roof tints. Full-saturation roofs read as a board game rather than a built` / ` * village, so these are four plausible roofing materials that lean towards their` / ` * player's hue: weathered clay tile, blue-grey slate, ochre pantile, pale shingle.` / ` * Ownership lives in the banner, pennant, painted trim and the terrace ring, which` / ` * is a better top-down read anyway.` / ` */` |
| `src/scene/GameScene.tsx` | 176 | `// owned by the composer.` | `// live in the composer.` The rest of that block is a keep. |

### Keep

These earn their place. Do not strip them.

| File | Line | Why it stays |
| --- | --- | --- |
| `scripts/generate-audio.py` | 407-409 | The loudnorm finding. Single-pass `loudnorm` applies time-varying gain and put a 3 to 4 dB jump at the loop point of every ambience bed. Deleting this guarantees somebody reintroduces it. |
| `scripts/compose.py` | 1134-1135 | Same finding on the music path, with "that bug has already shipped here once" attached. Keep the sentence. |
| `scripts/compose.py` | 332, 539, 875, 887, 1472 | Loop-point continuity notes. Each explains a non-obvious wrap or fade. |
| `src/scene/GameScene.tsx` | 171-176 | The composer forces `gl.toneMapping` to `NoToneMapping` while mounted, so anything set on the renderer is dead. Expensive to rediscover. |
| `src/scene/Water.tsx` | 289-290 | The standard shader only defines `vWorldPosition` under some feature combinations. A real Three.js constraint. |
| `src/scene/CameraRig.tsx` | 98-99 | StrictMode renders twice, so the telemetry object must be reused. Real bug prevention, minor wording tidy only. |
| `src/scene/structures/Buildings.tsx` | 18-27 | Merged geometry groups for draw-call cost, plus the deliberate decision to keep ownership out of the roof. Drop "any more" and keep the rest. |
| `src/scene/PostFX.tsx` | 315, 332, 365 | Grade-in-display-space and pass ordering. Non-obvious and load-bearing. |
| `src/audio/useGameAudio.ts` | 6-12, 19-22, 24, 28-34 | Why audio is scheduled against the animation timing constants, and why some beats ship silent on purpose rather than with a placeholder bleep. |
| `src/scene/terrain/hex.ts` | 340, 357 | Rim-to-floor grading and the blowout under a softer key. |
| `src/game/types.ts` | 67-71, 75, 81-90 | Which board constraints are invariants versus options, and what `BoardGeneration` records. This is the contract the create screen reads. |
| `src/ui/Dialogs.tsx` | 113, 127 | Two short docblocks explaining what `HarborRates` and `TradeSummary` are for. Already good. |
| `src/ui/Hud.tsx` | 193, 239 | The count-pulse and cost-pip explanations. |
| `scripts/bake/index.mjs` | 39-41 | Why the contact sheet and the driver are excluded from the pixel hash. "The orchestrator" here is the script's own driver function, not a process note. Consider renaming the function to `driver` so the word stops reading as process. |
| `scripts/blind-compare.py` | 1-13 | Describes what the tool does and how to recover the key. Same note: "the orchestrator" means the caller. Reword to "the caller" and keep. |
| `scripts/shot.sh` | 2 | One line describing what the script produces. Fine. |
| `src/scene/ocean/waveGlsl.ts` | 30 | Distance-field fallback outside the baked square. |
| `src/scene/structures/Harbor.tsx` | 220 | Polyline and shore-normal reasoning. |

### Working documents in `art/`

Different bar, since these are not shipped. Verdict per file.

| File | Verdict |
| --- | --- |
| `art/AAA-BRIEF.md` | **Split, then delete.** The durable half is the reference-image list and the performance budget. Move both into `art/STYLE_BIBLE.md`. Everything else is instructions to agents: "Read this first", "Current baseline gap (2026-07-26)", "Stay inside your file ownership", "Never claim a visual result you have not seen in a screenshot", "report done". That is scaffolding from how the game was built. |
| `art/STYLE_BIBLE.md` | **Keep.** This is the one that should survive as the art contract. Absorb the two durable sections from AAA-BRIEF. |
| `art/audio-manifest.md` | **Keep, trim.** The prompt-intent tables, the measured credit cost per second, and the loudnorm finding are real records. The running "Status: round two, July 26" and per-round spend narration should collapse into one closing section. |
| `art/bake-pipeline.md` | **Keep.** It documents `npm run bake`, the manifest contract, the output paths and why the bake exists at all. This is the closest thing the repo has to build documentation for the art pipeline. |
| `art/music.md` | **Keep.** Documents `scripts/compose.py`, what ships, and why the score is written in code rather than generated. |
| `art/REFERENCE_AUDIT.md` | **Keep.** It records the reference boundary and the no-Supercell-assets position. That is a legal-adjacent statement worth keeping. |
| `art/ui-direction.md` | **Trim hard or archive.** 27 KB, opens with "Written against the live build", "Note on the screenshots I graded", and "Interaction behaviour is owned by art/interaction-audit.md". It is a single review session. Extract any decision the current UI actually implements into `STYLE_BIBLE.md` and drop the rest. |
| `art/critique/*` | **Delete the images.** 33 MB of review screenshots and crops (`current-board.png`, `w1-terrain.png`, `crop-*.png`, `sheet-a/b.png`, `bake-sheet.png`). These are session detritus in a git repo. Keep `blind-verdict.md`, `music-score.txt` and `music-seams.png` if anything references them; regenerate `bake-sheet.png` on demand with `npm run bake:sheet`. |
| `art/qa/*` | **Delete.** 9.9 MB of before-and-after captures from one QA pass. Nothing reads them. |
| `README.md` | **Keep, one edit.** It is genuinely good and reads as product documentation, not process. Two things: it uses em dashes throughout, which the copy standard now bans, and the `KATAN is an unofficial prototype codename` callout should stay exactly as it is. |

---

## 5. Genuine bugs

Found while reading the copy. These are behaviour, not wording.

1. **Development card names render broken in the log.** `src/game/engine.ts`, the
   `play-development` branch, builds its event with
   `action.card.replaceAll('-', ' ')`, so the match log says "Marlow played year
   of plenty." and "Marlow played road building." Lowercased and unhyphenated.
   Use the `DEVELOPMENT_NAME` map that already exists in
   `src/ui/gameVisuals.ts`, or move that map into `src/game/` so the engine can
   reach it without importing UI.

2. **Screen readers hear two different vocabularies for terrain.** `App.tsx`
   `terrainName` maps `lumber → forest` and `wool → pasture` and leaves the other
   three alone, so one sentence reads "settlement beside forest 8, brick 6,
   pasture 3". Map all six, or map none.

3. **The player rail's stat summary has no owner.** `Hud.tsx` `PlayerRail` puts
   `aria-label={\`${vp} victory points, ${n} resource cards, …\`}` on
   `.player-stats` without the player's name. A screen-reader user tabbing the
   rail hears four numbers per row with no way to tell whose they are.

4. **"A development card costs ore, wool, and grain" fires when the deck is
   empty.** `engine.ts`, `buy-development`: the guard is
   `!state.developmentDeck.length || !hasResources(...)` behind one message. A
   player with all three cards is told they cannot afford something they can.

5. **Same conflation for settlements.** `engine.ts`, `build-settlement`: illegal
   placement, the five-settlement cap and unaffordability all return "That
   settlement is not legal or affordable." Three different next steps, one
   sentence.

6. **Disabled build buttons blame the wrong thing.** `Hud.tsx` build commands
   compute `choices` from `legalActions`, which is already filtered by cost, so
   an unaffordable settlement announces itself as "Settlement, 0 legal
   locations". The cost pips show the truth visually and the accessible label
   contradicts them.

7. **"Fill every seat before starting." does not say how many.**
   `room-service.ts` `startGame` has `room.seats.length` and `room.seatsTotal`
   in hand at the point it throws.

8. **The game-over modal is a trap.** `Dialogs.tsx` `ChoiceDialog` renders the
   `game-over` case as a `locked` modal with `onClose={() => {}}`, no close
   button, no Escape and no action of any kind. It shows whenever
   `game.phase === 'game-over'` while `stage` is still `'match'`, which is the
   window between the winning move and the server flipping `room.status`. During
   that window the player cannot dismiss it or do anything else. Give it a
   button.

9. **`awardChanges` produces "No one now holds Longest Road".**
   `useGame.ts` falls back to the literal string `'No one'` and then interpolates
   it into `${name} now holds Longest Road`. Losing an award reads as a
   grammatical error in the transition moment.

10. **A trade that everybody declines says nothing.** When the last recipient
    declines, `phase` returns to `action` and the offerer's screen simply stops
    waiting. There is no toast, no coach line, and the action tray is hidden for
    the whole of `trade-response`, so the offerer spends that time looking at a
    tray with no buttons and no explanation. Two gaps: a "Waiting on Marlow"
    state while it is pending, and a "No takers." toast when it resolves.

11. **The discard button never says how many more.** `DiscardDialog`'s primary is
    disabled until `total === required` and its label is
    `Discard ${total} / ${required}`, which is a score, not an instruction.

12. **The monopoly modal has no instruction.** `ChoiceDialog`'s `monopoly` branch
    renders a bare five-button grid under the title "Monopoly". A player who has
    not read the card is guessing.

13. **The agent runner advertises the vendor as the player's name.**
    `agent-runner/bin/katan-agent.mjs` builds `Codex Ember` / `Claude Moss`. The
    lobby already labels the seat as a local agent, so the prefix only takes room
    from the character and makes two runners of the same vendor look like a
    matched set.

14. **A revision number is printed on a player-facing surface.**
    `Hud.tsx` `AgentDecisionPreview` renders `Local agent · revision 47`.

15. **Two spelling systems in one screen.** The create screen says "Harbours" and
    "Centre" while the trade dialog says "Harbor" and the introduction says
    "neighboring". Pick American and apply it everywhere, including
    `src/scene/**` comment prose if that file is being touched anyway.

16. **Lobby colour labels are index-derived, not player-derived.**
    `Journey.tsx` builds seat colours from `colors[index]` rather than from the
    player's own `color`. It agrees with the engine today because the engine also
    assigns by index, but the lobby will silently lie the first time seat order
    and colour assignment diverge. Read `seat.color` if the room view carries it.

### Not a bug, checked

`room.boardSeed` does not appear in the create-room response from the locally
running room server, so the lobby shows no "Island seed" line. The process on
port 8787 started at 20:58 and `server/room-service.ts` was modified at 20:59,
so it is running stale code. Restart the room server before believing anything
about that field.

---

## 6. Partitioning the application pass

Three agents are live in these trees. Suggested split so nobody collides.

| Batch | Files | Rows |
| --- | --- | --- |
| **A. Copy-only, no logic** | `src/ui/gameVisuals.ts`, `src/ui/Dialogs.tsx`, `src/ui/Hud.tsx` | 3.8, 3.9, 3.10. Pure string swaps except the new monopoly and choose-victim body text, the new discard label branch, and the game-over dismiss button. |
| **B. Journey and shell** | `src/ui/Journey.tsx`, `src/App.tsx`, `index.html` | 3.1 through 3.7, 3.11, 3.15 (App rows), 3.16. Wait for the UI foundation pass to land before starting this one. |
| **C. Engine and server** | `src/game/engine.ts`, `src/game/useGame.ts`, `server/room-service.ts`, `server/realtime-server.ts` | 3.12, 3.13, 3.14, 3.15 (useGame rows). Independent of A and B. Bugs 1, 4, 5, 7, 9 land here. |
| **D. Names** | `src/game/engine.ts`, `src/App.tsx`, `src/scene/structures/PiecesLab.tsx`, `agent-runner/bin/katan-agent.mjs`, `src/agent/invite.ts`, `server/mcp-content.ts` | Section 2. Small and mechanical, but touches four trees, so do it in one commit rather than spread across A, B and C. |
| **E. Comments** | `src/scene/**`, `src/App.tsx`, `src/styles.css`, `scripts/**` | Section 4. Comment-only, so it can run last and rebase cleanly over everything else. |
