# Detail pass: menus with less in them, the achievements as a map, and a retro look

The user: "the menus are way too bloated, group them like minecraft style: play menu: continue world
with full width, then under it, new world and worlds, each half the width of the continue, with a
margin. then skip a button height, and then a 70% width button: example world. and a button back.
then the achievements have to be on a connected map, from left to right, with the unlocked being
marked green and the uncompleted gray, with also maybe icons, find or create relevant icons for
each achievement, each achievement box has only the title. then hovering on it expands with an
animation and reveals the description. and group settings by type with a left panel, and make the
ui style a little more retro rather than vibe coded look, more cyberpunk/retro style, all of it."

Shipped as Update 41 in the player's manual. No change to the simulation, the save or any world:
the menus read the state and the profile as before and write nothing new.

## What went wrong, and what it cost

All of these were found by looking: headless screenshots of the dev server, written to PNG and
read, at 1366 x 768 and at 420 x 820. No browser was opened on the user's screen.

- **The achievement boxes were too narrow for their titles.** At 150 px, "Green at the water's
  edge" wrapped to four lines and spilled over the lane below, covering its name. The boxes are
  now 184 px with a 28 px icon, and every title fits in two lines.
- **The in-game menu fell into a row.** The menu's buttons were moved into their own block so the
  Settings could take its place, and that block had no column layout of its own: Resume and Save
  stood side by side, with the save line squeezed between them. It now has its own column.
- **The planet's phase name looked struck through.** The drawer sets it at 22 px, and in the
  terminal face at that size the two-pixel cyan and magenta shadows crossed the letters. It is now
  36 px with one-pixel shadows.
- **A hover colour would have made a lit button unreadable.** The first rule for buttons turned
  every hovered button's text cyan, including the speed button that is already filled cyan
  (`.chip.on`): cyan on cyan. It was caught reading the stylesheet, before any screenshot. Only the
  menu buttons change their text colour on hover now; the rest light their edge.
- **The logo ran off a phone's screen** (96 px of "TERRAFORM" in 420 px), and **the settings' side
  panel squeezed the sliders to nothing**. The logo now scales with the screen's width; under 640
  px the kinds of setting run along the top, and each setting takes the full width.
- **One test pinned the old amber.** `settings-gate.test.ts` read the warning colour in the
  standard palette as `#e3b46e`. The standard warning is `#ffc23d` now, chosen for the new look;
  the colour-blind palettes, which were measured, are unchanged, and the test still checks that
  each one swaps in.
- **The city view was not seen restyled.** In the headless browser, which draws with a software
  GPU, opening one of the Example planet's cities was still "Surveying the ground" at 65% after 45
  seconds. The city's panels share the stylesheet's colours, corners and faces with everything
  else, which was seen; the city itself was not.

## What was built

### The title and Play

The title holds **Play** and **Achievements** at full width, a button's height of space, then
**Settings** beside **Credits**. **Play** holds **Continue** at full width, **New world** and
**Worlds** as two halves with a 10 px margin between them, a button's height of space (48 px less
the two 10 px gaps), **Example planet** at 70% width and centred, and **Back** under it. **Back**
from **New world** and **Worlds** returns to **Play**. Neither screen has a box around it: the
buttons stand on the planet, as Minecraft's menu stands on its world.

### The achievements map

A start on the left ("Landing"), a trunk down to a lane for each of the six groups, and each
achievement a box joined to the one before it, in the game's order. A box shows its icon and title
only; held under the pointer, or focused with **Tab**, it widens and its details open below it
(the grid-rows transition, over the lane beneath): earned or not, exactly what earns it, the world
it was first earned in, and "Rare" for the rare ones. Earned boxes are green with a green link
into them; the rest are grey. Colour is never the only sign: an earned box carries a tick where the
others carry a padlock, its details say "Earned", and a rare box has a double edge. The mouse wheel
moves the map sideways.

The icons are the game's own: 16 x 16 pixel art drawn in one colour (`currentColor`), one per
achievement, plus the start, the tick and the padlock (`src/web/achievement-icons.ts`). Each is an
SVG of crisp-edged rects, one per run of equal ink along a row. They took six rounds of drawing
and looking at a contact sheet. Six of the first motifs read as something else and were redrawn:

| Icon | First drawn as | Read as | Now |
|---|---|---|---|
| The caps let go | a domed cap with drops | a rain cloud | a flat ice slab with icicles and falling drops |
| Half an atmosphere | a round gauge | a clock | a half dial, its needle up, the far half in half ink |
| A network | three joined nodes | a warning triangle | a train's front on rails |
| A fortune | stacks of coins | springs | a money bag with a $ |
| Delivered | a crate with a tick | a calendar's checkbox | a taped parcel |
| Trusted by Earth | a handshake | a bow tie | a thumbs-up |

The weakest still: "The caps let go" could pass for dripping paint, "Everyone out" is busy at 1
px limbs, and the start's dome on its hill has a little of a service bell.

### Settings by kind

A side panel lists **Sound**, **Graphics**, **Controls**, **Keys**, **Interface** and **Saving**.
The keys, the longest list, have their own page now. One page is shown at a time, and the panel
opens on the page last shown this session. The arrow keys move along the list. Leaving the
**Keys** page while it waits for a key stops the waiting, so the game hears its shortcuts again.
In a world's menu the settings take the menu's place, with **Back**.

### The look

- **Colour.** Near-black navy surfaces, neon cyan (`#2ee6ff`) as the one accent, magenta for the
  display type's split shadow, and green, amber and red only where they mean something.
- **Shape.** Every corner square (`--radius: 0`), except what is round on purpose: a city's
  marker, radio buttons, and the 2 px outpost pin that the colour-cue register measures. Shadows
  are hard offsets, not blurs, and nothing is blurred behind a panel.
- **Type.** Chakra Petch for text, and VT323, a terminal face, for titles, menu buttons, labels
  and the buttons along the screen's edges.
- **Controls.** Bevelled menu buttons that light cyan on hover; square inputs, checkboxes,
  radios, sliders and scrollbars.
- **Panels.** Corner brackets on the floating panels, and faint scanlines and a vignette over the
  whole screen. High contrast turns the scanlines off.

The colour-blind palettes and high contrast work as before.

## The tests, and the faults they were checked against

New: `achievement-map.test.ts` (5), `achievement-icons.test.ts` (7), three in `app.test.ts` for the
title, Play and their Back buttons, and three in `settings-gate.test.ts` for the side panel. The
tests that walked the old title (`app`, `ending`, `settings-gate`, `sound-gate`) now open **Play**
first.

Each new test was checked by breaking what it protects, one fault at a time, with the file put
back after each. Every fault was caught:

| Fault | Caught by |
|---|---|
| Worlds before New world in Play | the title and Play's layout |
| No space before the Example planet | the title and Play's layout |
| Back from Worlds to the title, not Play | Back from Worlds and New world |
| The narrow buttons 60% wide | the grid as laid out by the stylesheet |
| A lane's boxes in reverse | a lane per group, every achievement in order |
| What earns it on the box's face | icon and title only |
| A padlock on every box, earned or not | the tick and the word |
| The details open before the box is held | the map as laid out by the stylesheet |
| Every settings page shown at once | one page at a time |
| The settings always opening on Sound | opens where it was left |
| The down arrow doing nothing | opens where it was left |
| A key still awaited after leaving Keys | leaving the Keys page lets it go |
| The menu's buttons left showing under the settings | opens where it was left, in a world's menu |
| An icon deleted; a row 15 wide; two icons the same; a rect per pixel; full and half ink merged; half ink at 0.5; an id like "toString" | `achievement-icons.test.ts` |

## Measurements

- The full suite (`npx vitest run --maxWorkers=2 --minWorkers=1`): 136 files, 1,637 tests, all
  passed (832 s), on the code before the final icons, the narrow-screen rules and the logo's scaling.
  A second run on the final code was stopped by the system for low memory on this machine after 48
  of 137 files, none failing. On the final code, the four files the icons reach (`achievement-icons`,
  `achievement-map`, `app`, `ending`: 35 tests) pass, as does typecheck.
- `npm run typecheck` passes; `npm run build:web` and `npm run build` pass. The web bundle is
  725.45 kB of script (242.81 kB gzipped) and 69.18 kB of stylesheet (12.81 kB gzipped); the
  stylesheet's source grew from 75.8 kB to 100.7 kB.
