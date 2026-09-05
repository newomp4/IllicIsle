# Illic Isle — Castaways Online

[Play Illic Isle](https://newomp4.github.io/IllicIsle/)

An online social deduction game for **3–10 friends**, built with a PS1 look.
Castaways finish island chores while hidden Rogue Agents hunt them and sabotage
the island. Report a body or ring the camp bell, discuss what happened, and vote.
Ghosts can keep helping with their assigned work.

The game now opens directly into an online-focused menu: **PLAY ONLINE**,
**HOW TO PLAY**, **CONTROLS**, and **OPTIONS**. Story Adventure and The Legend
have been removed from the game menus, including the old story shortcut.

## Start a room

1. Open the game, choose **PLAY ONLINE**, enter your name, and choose **CREATE ROOM**.
2. In the lobby, copy the four-character code or an invitation link for friends.
3. Friends can open the invitation directly, or paste a code/link into **PLAY ONLINE** and choose **JOIN ROOM**.
4. The host chooses the rules and starts with **START ROUND** once at least three players have joined.

**HOW TO PLAY** is also available in the lobby with `H` and from the game menu.
Guests can inspect the host's settings. After a round, the host can return
everyone to the same lobby for a rematch without exchanging new codes.

## Controls

| Action | Input |
| --- | --- |
| Move / look | `WASD` / mouse |
| Sprint / jump | `Shift` / `Space` |
| Interact / work | `E` / hold `E` |
| Map and jobs | `M` or `Tab` |
| Change camera | `C` |
| Knife or flare | `F` |
| Agent sabotage | `Q` |
| Draw pistol | `G` |
| Belt item | `1–9` |
| Game menu | `Esc` |
| Council chat | `T`, type, then `Enter` |
| Council vote | Select a name, then use the vote button or `Enter` |
| Older council messages | Mouse wheel; `End` returns to latest |

Opening the game menu **does not pause the online round**. The controls pages
explain additional gear and ghost controls. Keyboard and mouse are required;
there are no touch controls. Click the island to capture the mouse and press
`Esc` to release it. Audio, camera, graphics settings, and your name are saved
locally. Sound can be switched off in **OPTIONS**.

## Connection behavior

The host's browser runs the shared rules. Guests connect to it through WebRTC,
using the public PeerJS service to find the room. Keep the host tab open: host
migration and reconnecting into an active round are not supported. If the host
leaves, guests get an explicit room-closed screen.

The lobby and HUD show connection health and measured round-trip latency.
Temporary stalls show a warning; old movement snapshots are dropped when a
channel backs up so they do not flood the connection on recovery. A host that
loses its signaling connection attempts to reopen its room code while existing
data channels continue working. Background browser throttling can still affect
a host, so keep its tab active for the smoothest match.

Some network configurations block WebRTC connections. A different network or
phone hotspot can help. This is a friend-hosted game: roles and important
shared actions are checked by the host, but wallets, inventory, and minigame
outcomes still include client-owned state. It is not a server-authoritative
competitive service.

## Local development

The game is static files with vendored Three.js and PeerJS and no build step.
Serve it over HTTP; ES modules do not work through `file://`.

```bash
node serve.mjs                 # http://localhost:8000
```

The development server disables caching so module edits load together. Deploy
the static directory to GitHub Pages or another static host; multiplayer also
requires access to the signaling service and WebRTC.

Node 24 or later runs the regression suite without installing dependencies:

```bash
node --test tests/*.test.mjs
```

The suite covers online session rules, rematches, room transitions, voting,
network lifecycle, invites, controller state, compact HUD layouts, notification
queues, screen navigation, minigames, text bounds, rendering math, and audio.
Some shared-world regressions retain legacy base-class fixtures because online
play reuses that engine.

Optional real-browser checks start their own local server and save screenshots
to a temporary directory. All test browsers launch muted.

```bash
npm install --no-save playwright
npx playwright install chromium
node tests/browser-smoke.mjs

# Also connect three real browsers through the public PeerJS service:
LIVE_MULTIPLAYER=1 node tests/browser-smoke.mjs
```

The live check exercises invites, lobbies, role briefing, chat, voting, results,
rematch, departure, and host loss. It moves a player to the bell and advances
the task counter to exercise those transitions; individual task rules are
covered by the Node suite. It needs internet access and a working public broker.
Use `BROWSER_CHANNEL=chrome` for installed Chrome, `PLAYWRIGHT_MODULE` for a
shared Playwright module, and `SMOKE_OUTPUT` to choose the screenshot directory.

Local debugging exposes `window.__game` on loopback hosts only. The existing
workshop additionally requires `?workshop=1` and room `7226`; that room behaves
normally on the public game.

## Code map

| Location | Purpose |
| --- | --- |
| `js/main.js` | Startup, invitations, graphics recovery |
| `js/mp/mpgame.js` | Online play, world interactions, round presentation |
| `js/mp/session.js` | Host rules and guest session state |
| `js/mp/avatar.js` | Remote players and interpolation |
| `js/mp/tasks.js` | Task definitions and stages |
| `js/net/` | WebRTC transport and message protocol |
| `js/lib/screens.js` | Canvas menus, lobby, council, shops and minigames |
| `js/lib/hud.js` | Online HUD, compact notices, compass and equipment |
| `js/lib/bitfont.js` | Bitmap text, wrapping and fitting |
| `js/lib/ps1.js` | Retro rendering pipeline and screen projection |
| `js/game.js`, `js/world/`, `js/entities/` | Shared world and engine |
| `tests/` | Regression and browser checks |

Geometry and textures are generated in code, and WebAudio synthesizes the music
and effects. Options adjust the low-resolution framebuffer, vertex jitter,
dithering, CRT treatment, and foliage density. The HUD stays stable and legible
as the world effect changes. Resolution applies immediately; foliage changes
require reloading to rebuild the island.
