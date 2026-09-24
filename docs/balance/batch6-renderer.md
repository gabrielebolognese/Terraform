# Batch 6 note — the macro renderer

Design doc §9's channels, turned into pixels. What the renderer is, why it is software, and the four
defects that measuring §0.3 uncovered.

Twelve reference frames in [`docs/frames/`](../frames/), and the whole arc at once in
[`contact-sheet.png`](../frames/contact-sheet.png). Regenerate with `npm run sim:frames`.

---

## 1. A software rasteriser, on purpose

`renderPlanet(channels, options) -> Frame`. Pure, deterministic, no canvas, no WebGL, no DOM — it is
compiled against `lib: ["ES2023"]` with the DOM deliberately out of scope, so it *cannot* reach for a
browser API even by accident. `src/web/planet-view.ts` does the blitting and nothing else.

The reason is the exit gate. Twelve committed PNGs compared per pixel is only possible if the renderer
runs in Node, and WebGL does not. A GPU path would need headless GL or a browser in CI, and every
driver or library bump would shift pixels and churn the goldens for no change in the picture. This
runs identically in Node and the browser — an unmodified render reproduces the committed PNGs
**exactly**, 0.0000%, not approximately.

When resolution eventually wants a GPU, a backend can slot in behind the same signature. The golden
frames are what would keep it honest.

## 2. The contract is the whole interface, and that is structural

`src/render/` imports `VisualChannels` and nothing else. `boundary.test.ts` now checks this from the
renderer's side, in four ways: no sim import but that one type, no mention of a reservoir or `phase`
or `progress`, no DOM, no clock, no `Math.random`. Each guard was verified by injecting the violation
it is meant to catch — the session that added them had already been bitten once by a regex whose
anchors had been silently eaten, and a vacuous architecture guard is worse than none.

A renderer that *can* read `reservoirs.h2o_ice` will read it the first time a channel is inconvenient,
and from then on §9 documents an interface that is no longer the real one.

## 3. §0.3, measured — and four things it caught

§0.3 names the failure this batch exists to prevent: terraforming that reads as "colored keys" gating
progress while the planet barely changes on screen. A renderer can draw a perfectly good planet and
still fail that completely, so `planet.test.ts` sweeps every channel across its range and asserts
three things: **every tenth moves the image**, **the image moves monotonically away from the
channel's zero**, and **no single tenth carries more than 40% of the range**.

Writing that test found four real defects. None of them were visible as "the planet looks wrong".

**The elevation field was not uniform, so no coverage channel was honest.** Thresholding fractal noise
at `c` covers `c` of the surface only if the noise is uniformly distributed, and `fbm` piles up hard
around 0.5. An analytic sine-warp was tried first and was not enough: the warped field thresholded at
0.36 still covered **18.6%** of the disc. Every coverage channel was reading at about half strength.
Fixed by rank-transforming the field once per scene — measuring the distribution instead of assuming
one — which makes coverage exact rather than approximate, and retired the warp helper entirely.

| threshold | before | after |
|---|---|---|
| 0.10 | 0.001 | 0.100 |
| 0.36 | 0.186 | 0.360 |
| 0.70 | 0.827 | 0.700 |

**The pole sat exactly on the limb, so `capRadius` was dead over its first tenth.** Pole-on, a cap of
radius 0.1 is a one-pixel sliver at the top edge — the channel moved the image by 0.00000. A 0.42 rad
axial tilt turns it into an ellipse whose area tracks the channel. The cap's low-end response is still
quadratic, but that is the geometry being right: `capRadius` is an angular radius, so area goes as
`1 - cos(r·π/2)`, and the round trip from the sim's `acos(1 - f)` is exact — the drawn cap area *is*
the ice fraction.

**The cloud threshold was one-sided, so `cloudCover` was dead over its first 15%.** The shoreline had
always used a smoothstep centred on its threshold; clouds used a one-sided one, and the softness ate
the entire band at low cover. Centring it fixed it, and because the field is now exactly uniform,
softening the edge no longer biases coverage at all.

**Vegetation was thresholded on an exponential proximity field**, which is clustered hard near zero —
so `surfaceGreen` moved the image 7× faster in its middle than at either end. Replaced by ranking the
land by normalised elevation, which is uniform by construction and still means "spreads up from the
water's edge".

After all four, every channel moves at every step, monotonically, with no tenth carrying more than 27%
of its range. `dustIntensity` and `atmosphereThickness` are exactly linear; sky and tint are linear to
within measurement.

## 4. The golden tolerance was wrong by 10×, and only injection showed it

The build plan named 2% mean absolute per-pixel difference. That number was written before anything
had been measured, and it is useless as a gate. Three deliberate regressions were injected to check,
and **all three passed at 2%**:

| injected change | actual difference |
|---|---|
| rock colour 3% redder | 0.068% |
| ocean threshold moved by 0.02 | 0.077% |
| cloud edge softened 0.26 → 0.30 | 0.356% |

The real scale is set by the render being bit-exact. The only thing the tolerance has to absorb is a
platform difference in the last ulp of a trig call, which can flip a pixel sitting precisely on a
smoothstep edge — a few dozen such pixels at 128×128 come to about 0.0004%. **0.2%** sits ~500× above
that and still catches the smallest visible change. It is now `TOLERANCE` in
`golden-frames.test.ts`, and the plan's figure has been corrected.

This is the second time in this project that a threshold written from a plan rather than from a
measurement turned out to be vacuous. Worth a habit: a new tolerance is not finished until something
has been injected that it is supposed to fail.

## 5. The late game does not change, and the test says so

The frames are sampled at fixed *progress*, so consecutive pairs are ~8% of the bar apart. Every pair
clears a 1%-of-full-scale change except three:

| pair | progress | sim-years | Δ |
|---|---|---|---|
| 7 → 8 | 0.64 → 0.73 | 944 → 1226 | 0.0094 |
| 8 → 9 | 0.73 → 0.82 | 1226 → 1548 | 0.0083 |
| 9 → 10 | 0.82 → 0.90 | 1548 → 1756 | **0.0042** |

By year 482 the ocean has settled at 0.36, greenness at 0.64, and the caps are long gone. Across that
whole stretch the only channel still moving is `atmosphereThickness`, 0.80 → 0.91 — and it shows up
almost entirely in the limb glow. The middle of the disc is static.

**This is a pacing finding, not a renderer one.** The channels themselves are flat there; no amount of
drawing fixes a planet that has stopped changing. §0 asks for "visible change at least every few real
minutes" and the last third of the run does not deliver it.

Rather than lower the bar to whatever the code happens to do, the three pairs are a named quarantine
in `golden-frames.test.ts`, with a guard that stops the list growing **and** stops the listed pairs
getting flatter. It joins the open balance items for a later batch.

## 6. Cost, and what the browser does with it

The camera-dependent work — sphere, elevation, clouds, lighting, and both rank transforms — is baked
once into a `PlanetScene` and reused for every set of channels. It is the difference between a live
readout and a slideshow:

| size | scene, once | composite, per frame |
|---|---|---|
| 128² | 32 ms | 3.5 ms |
| 220² | 44 ms | 7.7 ms |
| 260² | 68 ms | 10.0 ms |

Before caching, a 260² frame cost **77 ms** — every frame.

The browser renders at `PLANET_SIZE = 220` and lets CSS scale it. It deliberately does **not** follow
`devicePixelRatio` the way the sparklines do: doubling for a retina display quadruples the work, and a
slightly soft planet costs far less than a stuttering one. A redraw is skipped entirely when no
channel has moved by more than 0.002 — the same threshold the goldens treat as invisible — because at
1× speed the channels move by far less than a pixel level between readouts.

**The planet does not rotate.** Spinning it means rebuilding the scene (44 ms) every frame of the
rotation, or caching one per angle at ~1.4 MB each. Neither is worth it: §9's claim is that the planet
changes because the *world* changes, and a rotation would be motion that means nothing.

## 7. What the arc looks like

From `contact-sheet.png`, left to right, top to bottom:

- **0.12** (year 42) — rust Mars, a broad white cap, thin dark sky, dust in the air
- **0.18** (year 288) — cap retreating, atmosphere thickening to a warm butterscotch haze
- **0.24–0.31** (years 340–364) — water appears and spreads; the first green
- **0.38–0.46** (years 368–482) — green takes the land, clouds arrive, the haze clears
- **0.55–0.96** (years 688–2140) — a blue-limbed living world; §5's long tail, and §5's flat one

## 8. For the next batch

- `PlanetScene` is per-camera. Anything that moves the camera pays 44 ms; design around it.
- The renderer has no idea *where* anything is. Basin shapes, real cap placement and the hypsometric
  curve are still §12's deferred "spatial resolution" question — the contract stays global, and the
  terrain here is noise that merely *respects* the global fractions.
- Batches 3–5 have still had no adversarial review, and Batch 6 has had none either.
