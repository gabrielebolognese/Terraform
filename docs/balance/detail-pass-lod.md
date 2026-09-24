# Detail pass: three levels of detail, and loose rocks

An intermediate task after the example planet, at the user's request: *"currently in metropolis if
i zoom out a lot it lags … add 3 stages of quality, so that the quality drops if i zoom out and i
can move around"*, and *"right now there are bad mountains only, add also: rocks"*.

| Level | Buildings | Ground | Moving parts, steam |
|---|---|---|---|
| High | Everything, as before | Every tile, hill rocks, and now loose rocks on open ground | Yes |
| Medium | Each building's main shapes, with coarser curves and no small parts | Every tile, hill rocks with fewer sides | No |
| Low | One block per building, round buildings eight-sided, in the colour the building shows at high | Flat 4×4 patches merged; slopes kept tile by tile | No |

Each level keeps its own cache (draw order, ground, building shapes), so zooming in and out never
rebuilds anything already built.

**The level follows how many tiles are on screen, not the zoom alone**
(`qualityFor` in `src/web/city-camera.ts`):
- high up to 1,500 tiles on screen;
- medium up to 6,000 tiles;
- low beyond that.

An ordinary city's whole grid is 1,024 tiles, so **cities keep full detail at every zoom; only
metropolises step down**. A bigger window shows more tiles, so it steps down sooner.

## Measured

The example's largest metropolis: 758 buildings on 9,216 tiles, viewed at 1600×900.

| Zoom | High | Medium | Low |
|---|---|---|---|
| 0.3 (fully out) | 226,364 shapes | 38,631 | 14,321 |
| 0.5 | 162,644 | 25,883 | 9,595 |
| 1.0 | 58,900 | 8,248 | 2,886 |

Canvas cost grows with the shape count. **Fully zoomed out, the city now draws about 6% of the
shapes it drew before (low).** At zoom 0.5 it draws 16% of them (medium).

**How close each level looks to high.** Measured as the difference from the full-detail frame,
averaged over 8×8-pixel blocks (the eye's view from that far):

| Picture | Difference from high |
|---|---|
| Bare ground, no buildings (the yardstick) | 0.0251 |
| Medium | 0.0078 |
| Low | 0.0093 |

**Building by building**, rendered alone on flat ground:
- at low, every type's mean colour is within 1% of its full-detail drawing, and covers 80–127% of
  the same pixels;
- at medium, colours are within 15% (the reactor is the worst).

**Loose rocks cover 0.27% of an open test frame** (the grid fills about half of it): pebbles on a few
tiles, not a rubble field.

## What went wrong

- **The first far view looked less like the city than bare ground did.** Its pixel difference from
  high was 0.0386, against 0.0335 for bare ground. There were two causes:
  - **Ground:** flat patches were merged over slopes too. That erased the terraces and painted a
    whole patch steep-coloured if one of its tiles was steep. On bare ground, low differed from high
    by 0.0206; merging only truly flat patches brought it to 0.0012.
  - **Buildings:** each block took its building's main material, so greenhouses came out bright green
    and depots bright white. Up close, greenhouses read grey through glass.
- **The first fix for the colours was worse.** I used each building's measured on-screen colour, but
  that colour is already lit, and the renderer lit it again, so every block came out dark grey. Two
  rounds of calibration fixed it, scaling each colour by measured ÷ drawn. Blocks now come within 1%.
- **The calibration measured the wrong pixels at first.** Placing a building breaks the merged
  patches around it, and patches carry no checker pattern, so "pixels that changed" counted ground
  too. That gave a dome four times its real area and a reddish mean. The calibration now uses ground
  whose tiles never merge.
- **Medium greenhouses and solar arrays were off-colour:** 28% too green and 25% too dark. The
  vault was bare leaf-green where high shows glass over crops. Fixed to within 7% and 2.5%.
- **Five of the first tests missed their injections**:
  - the ground check was too loose to see the terraces;
  - the reference city has no spaceport, so "every type" skipped one type;
  - removing a building uncovers ground, so the scene changed whether or not the building drew
    anything;
  - two injections were equivalent to the original (medium and low kits carry no steam; each level's
    building cache already sits inside its own scene cache). I removed the redundant key part rather
    than keep it.
  
  Rewritten; all 13 injections are now caught, each by the test meant to catch it.
- **A 230,000-shape `toEqual` crashed vitest's diff printer** ("Invalid array length") instead of
  failing. Large scenes are now compared by first differing index.
- **A sed command corrupted two files.** In GNU regex, `` \` `` means "start of buffer", so the
  command put a backtick at the start of every line of `city.ts` and the new test file. The damage was
  one character per line, and a checked script removed it exactly. The diff against the last commit
  confirmed nothing else moved.

## Open

- The medium level's colours could be calibrated like low's (worst now 15%, the reactor).
- The level switches instantly at its thresholds. A little hysteresis would stop it flickering
  when the zoom sits right on a boundary.
