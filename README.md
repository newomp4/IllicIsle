# IllicIsle — The Idol of Isla Dorada

A PS1-style castaway adventure that runs in a browser tab. Wash up on a
tropical island, find four carved Marks, open the sealed cave in the red
cliff, and take the Golden Idol of Chris Illich off the man who's been
guarding it for eleven years.

**Controls:** `WASD` move · mouse look · `Shift` sprint · `Space` jump ·
`E` interact · `Left click` throw a coconut · `Tab` journal · `C` swap
first/third person · `Esc` pause.

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

## What's actually in here

Nothing is downloaded at runtime. Every texture is drawn into a `<canvas>`
on load, every model is built from primitives in code, and all the music and
sound effects are synthesised with WebAudio. The only dependency is a
vendored copy of Three.js r160, committed to `vendor/`. Total repo is under
a megabyte and the page has zero external requests, so it can't break when
some CDN moves.

```
index.html            shell, menus, HUD markup
css/style.css         retro UI
vendor/               three.module.js (r160, MIT)
js/
  main.js             boot, menus, frame loop
  game.js             story, interactables, scene transitions, combat glue
  ui.js               HUD, compass, journal, typewriter reader
  lib/
    ps1.js            vertex snapping, affine UVs, low-res + CRT composite
    textures.js       the entire texture atlas, painted pixel by pixel
    geo.js            primitive factories, merging, limbs, bends
    audio.js          three looping tracks and ~30 one-shots
  world/
    terrain.js        island height function, ocean, foam, sky
    props.js          palms, jungle, wreck, shrine, sealed door
    idol.js           the Idol itself
    cave.js           the chamber, dais, and Hector's camp
  entities/
    player.js         third/first-person controller + walk cycle
    boss.js           Hector, "El Bass Presidente"
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

All of it is adjustable in **Options** if you'd rather have a clean image —
resolution, jitter and the CRT pass can each be turned off independently.

### Notes

- Needs a keyboard and mouse; there are no touch controls.
- Pointer lock is used for mouse look, so the first click captures the
  cursor and `Esc` releases it.
- Settings persist in `localStorage`.
- Performance scales with the **Foliage density** option; drop it to LOW on
  an older laptop. Render resolution is the other big lever.
