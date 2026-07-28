# Illic Isle

A PS1-style castaway game that runs in a browser tab. Two ways to play, one
island.

**Single player — The Idol of Illic Isle.** You wash ashore alone. Wake the
four Rogue Pendulums the Agents left behind, read the glyph on each one, set
the temple door in that order, and take the Golden Idol of Chris Illic off
Hector — *El Bass Presidente* — who has been guarding his brother's remains
down there for eleven years.

**Castaways — 3 to 10 players.** Same island, same night, but some of you
are Rogue Agents and nobody knows who. Castaways work: wind the pendulums,
patch the sail, restock Ferdi's shelves. Agents cut them down one at a time
and jam the island when it suits them. Find a body, call a council, argue,
and throw somebody to the sea. Runs peer to peer — no server, no accounts,
just a four-letter room code.

**Controls:** `WASD` move · mouse look · `Shift` sprint · `Space` jump ·
`E` interact · `Left click` throw a coconut (single player) or strike
(Castaways) · `Q` sabotage wheel (Agents) · `Tab` journal · `M` chart ·
`C` swap first/third person · `Esc` pause.

---

## Deploying to GitHub Pages

The whole game is static files with no build step, so this is three commands:

```bash
cd IllicIsle
git init && git add -A && git commit -m "IllicIsle"
gh repo create IllicIsle --public --source=. --push
```

Then turn Pages on — either in **Settings → Pages → Source: Deploy from a
branch → `main` / `(root)`**, or:

```bash
gh api -X POST repos/:owner/IllicIsle/pages -f source[branch]=main -f source[path]=/
```

It'll be live at `https://<your-username>.github.io/IllicIsle/` in a minute
or two. Send that link to anyone; nothing needs installing.

To test locally first (ES modules need a real server, `file://` won't work):

```bash
python3 -m http.server 8000    # then open http://localhost:8000
```

---

## How multiplayer works without a server

A GitHub Page is static, so there is nowhere to run authoritative game
logic — except in somebody's browser. One player is the **host**: their tab
owns the truth about roles, tasks, kills and votes, and everyone else sends
intents and renders what they are told. That keeps exactly one copy of the
rules, and makes cheating a matter of editing the host's page rather than
any player's.

The connections themselves are WebRTC data channels, arranged in a star with
the host at the centre. The only thing that needs a server is the initial
handshake, and PeerJS's free public broker does that: the host claims the
room code as its peer id, everyone else dials it. After the handshake the
traffic is browser to browser and the broker never sees it again.

Positions arrive about twelve times a second, which would look like a
slideshow drawn straight. Each avatar keeps a short buffer and renders
roughly 120 ms in the past, interpolating between the two snapshots that
straddle that moment — a tenth of a second of latency in exchange for motion
that never stutters, which for a game about watching where people walk is
the right side of the trade.

Practical notes:

- Some corporate and university networks block the peer-to-peer handshake.
  If a room won't connect, try a phone hotspot.
- If the host closes their tab, the game ends for everyone. That is the
  price of not running a server.
- Room codes are namespaced on the shared broker, so a code only ever
  collides with another Illic Isle game.

---

## What's actually in here

Nothing is downloaded at runtime. Every texture is drawn into a `<canvas>`
on load, every model is built from primitives in code, every letter of every
menu is a hand-set 5×7 bitmap, and all the music and sound effects are
synthesised with WebAudio. The dependencies are a vendored copy of Three.js
r160 and a vendored copy of PeerJS, both committed to `vendor/`. The page
makes zero external requests once loaded, so it can't break when some CDN
moves.

```
index.html            loading screen and the canvas; everything else is drawn
css/style.css         the loading screen and the lightning flash
vendor/               three.module.js (r160, MIT), peerjs.min.js (MIT)
js/
  main.js             boot and the frame loop
  game.js             story, interactables, scene transitions, combat glue
  ui.js               the thin API the game calls to change what's on screen
  lib/
    ps1.js            vertex snapping, affine UVs, low-res + CRT composite
    bitfont.js        the 5×7 glyph table everything is lettered with
    hud.js            hearts, compass, task list, name tags
    screens.js        every full-screen interface, drawn as pixels
    textures.js       the entire texture atlas, painted pixel by pixel
    geo.js            primitive factories, UV stamping, merging, limbs
    cutscene.js       shot lists, timed events, captions
    audio.js          five looping tracks and ~30 one-shots
  world/
    terrain.js        island height function, ocean, foam, sky
    props.js          palms, jungle, undergrowth, the Rogue Pendulums
    temple.js         the temple, its stairs, and the collision that matches
    idol.js           the Idol itself
    extras.js         Syncoin, relics, Ferdi's hut, the storm, torches
  entities/
    player.js         third/first-person controller + walk cycle
    boss.js           Hector, "El Bass Presidente"
  net/
    net.js            WebRTC transport, star topology, room codes
    protocol.js       every message that crosses the wire
  mp/
    session.js        the rules of Castaways, run by the host
    mpgame.js         Castaways on top of the single-player world
    avatar.js         other players, interpolated
    tasks.js          the chores and the sabotages
```

### The PS1 look

Three things made PlayStation 1 graphics look the way they did, and all
three are reproduced rather than faked with a filter:

1. **Vertex snapping.** The console's GTE had no sub-pixel precision, so
   screen-space vertices quantised to a grid and the world wobbled. Every
   material is patched to round `gl_Position.xy` to the framebuffer grid.
2. **Affine texture mapping.** No per-pixel perspective divide, so textures
   swam on large triangles. Emulated by passing `uv * w` and `w` as varyings
   and dividing them back in the fragment shader, which cancels the
   rasteriser's perspective-correct interpolation exactly.
3. **A 320×224 framebuffer** with 15-bit colour, ordered (Bayer) dithering,
   scanlines and a slight barrel curve, upscaled with nearest-neighbour.

The interface is drawn into that same framebuffer rather than sitting on top
of it in DOM, so it pixelates, dithers, bands and curves along with the
world. That is also why the font is hand-built: canvas and CSS both
antialias type no matter how you ask them not to, and the only way to get
hard pixels is to own the glyphs.

All of it is adjustable in **Options** if you'd rather have a clean image —
resolution, jitter and the CRT pass can each be turned off independently.

### Notes

- Needs a keyboard and mouse; there are no touch controls.
- Pointer lock is used for mouse look, so the first click captures the
  cursor and `Esc` releases it.
- Settings and your Castaways name persist in `localStorage`.
- Performance scales with the **Foliage density** option; drop it to LOW on
  an older laptop. Render resolution is the other big lever.
