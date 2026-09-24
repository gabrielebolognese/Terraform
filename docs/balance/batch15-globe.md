# Batch 15 — The full-screen globe

A direct request, not from the backlog: the planet was a 260 px canvas inside the instrument panel,
on a page that scrolled. It is now the page. The planet fills a 100vw × 100vh stage, turns when
dragged, zooms on the wheel, and is shaded per pixel at display resolution against a starfield. The
HUD floats over it on the left; the instruments are a drawer on the right.

**A graphics change only.** No simulation, tuning, contract or balance code changed. The golden run,
the Batch 3 score and the golden frames are exactly as they were. 604 tests pass, up from 590.

---

## What was built

| Piece | Where | Note |
|---|---|---|
| GLSL port of the renderer | `src/render/globe-shader.ts` | Same noise (the integer hash reproduced in `uint` arithmetic), fields, colours and compositing order as `planet.ts`. The constants are written **into** the shader from `planet.ts`, so they can't drift apart. |
| Sphere CDF tables | `src/render/sphere-cdf.ts` | The GPU's version of `rankTransform`, so a coverage channel still colours that share of the surface. |
| WebGL2 plumbing | `src/web/globe.ts` | Compiles the shader and uploads the tables, plus drag, inertia, wheel zoom, an adaptive render scale and a software fallback. |
| Drag, inertia and idle-spin math | `src/web/orbit.ts` | Pure, unit-tested. |
| Layout | `src/web/main.ts`, `style.css` | Full-viewport stage; HUD panel on the left, which scrolls inside itself; instruments drawer on the right; no page scroll. |
| Inspector | `src/web/inspector.ts` | No longer owns a canvas. It feeds the globe through a `PlanetSink`, live or from the arc scrubber. |

The shared foundation came first: the four noise fields were pulled out of `createScene` into named
functions (`elevationField`, `cloudFieldAt`, `capWobbleAt`, `dustHazeAt`) that the shader ports and
the CDF ranks. The golden frames confirmed that refactor was exact.

Presentation the globe adds, none of it in the contract:
- relief shading of the land from a high-frequency detail field;
- roughened rock colour and coastlines;
- sun glint on water;
- clouds drifting slowly over the ground;
- an atmosphere rim brighter on the sunlit side;
- a starfield and faint nebula.

## What this overrides

**Batch 6 decided the planet does not rotate**: "a rotation would be motion that means nothing"
(`config.ts`, `PLANET_SPIN`). That was an explicit design call, and this request reverses it. The
reason no longer applies: the cost it cited was rebuilding a CPU scene per angle, and the GPU globe
has no per-angle cost. `PLANET_SIZE`, `PLANET_SPIN` and `PLANET_REDRAW_EPSILON` are gone with
`planet-view.ts`.

## What went wrong, and what is unverified

- **Nobody has looked at it.** The project rule is that I never open a browser, and WebGL can't run
  in Node, so I haven't seen a rendered frame of the globe. What was verified instead:
  - both shaders compile under Khronos's reference compiler (`glslangValidator`, GLSL ES 3.00), and
    that compiler was proven to reject a deliberately broken copy;
  - the dev server resolves the whole 52-module graph;
  - the page builds;
  - happy-dom mounts the assembled page;
  - the coverage tables are correct: 0.35% worst error over independent random points.

  How it looks, and how fast it runs on a given GPU, is what you'll see first.
- **The golden frames pin the software renderer, not the globe.** Parity is by construction, since
  the shader is a port with shared constants, not by comparison. A GPU frame can't be compared in CI.
  If the two ever disagree, the goldens will stay green.
- **Performance is managed, not measured.** The shader evaluates about 30 noise lookups per disc
  pixel. The render scale drops toward 0.5× when frames run over 26 ms, and recovers under 15 ms.
- **A fallback exists for browsers without WebGL2**: the software renderer, scaled up, re-baked at
  most four times a second while turning. It's softer and steppier, but the same planet.

## Tests added

- **Sphere CDF:** coverage honesty measured on independent points, and a vacuity check that the raw
  field is badly non-uniform (off by 0.24–0.28). A skewed binning fails it.
- **Orbit:** turn rate, pole clamp, inertia and its decay, hold, idle spin, zoom bounds. Removing
  the clamp or the friction fails it.
- **Page assembly:** the planet is on the stage, behind the panels, and the scrubber is in the
  instruments.
- **The inspector feeds the globe:** a real update reaches the sink. Cutting that wire fails it.

---

## Follow-up: direction, clouds, and the look

**The planet turned against the hand, and I shipped it that way.** The shader spun by `+yaw`, which
carries the surface *left* as yaw grows, and a drag to the right increases yaw. None of the first
round's tests checked direction; they checked turn rate, clamps and inertia. You found it in the first
minute of use. The fix is in the shader's sign, `-uYaw`, so the idle spin now runs west to east like a
real planet. The rotation is mirrored in TypeScript as `toPlanetJs`, and `orbit.test.ts` now requires
that dragging right brings the ground from the left of centre to the centre, at two tilts. The old sign
fails it by 20×. The mirror is only a mirror: the GLSL and the TypeScript still have to be kept in step
by hand.

**Clouds.** The globe had been reusing the software renderer's 3-octave cloud field with its 0.26
edge softness, which was tuned for a 128 px frame and read as fog at full resolution. The globe now has
its own field, `cloudFieldHighAt`: 6 octaves pulled into swirls by a low-frequency domain warp, with
its own sphere CDF, so the cloud channel still covers exactly its share (added to
`sphere-cdf.test.ts`). The shading changed too:
- a sharp, symmetric 0.06 edge;
- thick cores that are brighter and nearly opaque;
- thin margins broken into wisps by fine noise;
- sun-lit tops.

The software renderer and the golden frames keep the original field.

**The look.** The stylesheet had about 80 hand-picked colours, warm brown in the instruments and blue
slate in the HUD, set in a monospace font. They're now one dark-gray token system:
- **surfaces** stepping up from `#0e0f11`, with three text tiers;
- **colour only where it means something:** one calm blue accent (`--accent`), plus green, amber
  and red for good, attention and wrong;
- **Lexend** from Google Fonts, falling back to Arial;
- **text one pixel larger** at every size, with tighter tracking;
- **tabular figures** on numbers that update in place.

The colours were mapped mechanically by lightness, saturation and hue, then reviewed before applying.
The first pass sent near-white text to the accent and the old brand rust to "warning", and both were
fixed before anything was written. The dimmest text tier is about 4.9:1 against the panels, above the
WCAG AA bar.
