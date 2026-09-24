# Detail pass: roads, connections and rovers

An intermediate task after the levels of detail, at the user's request: *"add also: rocks, moving
rovers, roads, connection points, for example, i need to connect the powerplan to the mines to
activate them, or connect the greenhouses to the habitable zones."* (Rocks are in
[`detail-pass-lod.md`](detail-pass-lod.md).)

Micro §6 anticipated this: *"a simple 'connected to the settlement network' boolean per building is
enough for the foundation. Pipe/cable routing can be added later without touching the sim."*
§7.1: *"A building is operable this tick only if it is connected to the network."*

## The rule

Behind `NETWORK_ENABLED` (default 0; the browser uses 1):
- **What forms a network.** Buildings join one network by sharing a wall, or by touching a road.
  Roads join by touching each other.
- **What it takes to run.** A building that draws a resource runs only if its network holds a
  running producer of that resource:
  - a mine needs a power plant on its network;
  - a dome needs a greenhouse on its network, and producers of power, water and oxygen as well.
- **What the player sees.** A building kept off this way is marked with its own badge, a broken
  link. The inspector names what's missing and where to connect: *"Not connected: nothing on its
  network makes power. Lay a road to a power plant."*

**Roads are the only new saved data** (save schema v7: tile keys `ty * 1024 + tx`). Which buildings
share a network is worked out fresh each substep and cached per (buildings, roads). The rule only
ever switches buildings off, inside §7.2's brownout loop, so the step still settles from above and
stays chunk-independent (tested: `advance(s, 40)` equals ten `advance(s, 4)`).

**Playing it:**
- **Road**, in the Build palette, costs 1 material a tile (`COST_ROAD`). Click or drag to lay road;
  a drag that starts on a road takes road up.
- Roads are refused on steep ground, under buildings, off the grid, or without the materials.
  Buildings are refused on roads.
- **Connect everything** lays and pays for the shortest roads that join every building into one
  network, wherever the ground allows (`roadsToConnect`: breadth-first over open, buildable ground).

**Older saves** load with the roads that connect what they already had, free. A player who built a
working city must not load it and find a new rule has switched it off.

## In the picture

| | High | Medium | Low |
|---|---|---|---|
| Road | Surface, kerbs where it ends, a centre dash on straight stretches | Surface, in the colour it reads as from afar | Same as medium |
| Connection point: one per building side, on the road tile nearest the middle of that side | Pedestal, amber lamp, conduit to the wall | Pedestal | — |
| Rovers | Six-wheeled, three liveries, shuttling each straight stretch of 3+ tiles and keeping right | — | — |

Rovers are drawn, not simulated (micro §8): a pure function of the layout and the time, drawn with the
road tile they are on.

## The example planet

Streets now run on every open, buildable tile beside a building, and `roadsToConnect` joins
whatever the streets leave apart. **All 42 settlements are one network each, and every one of the
3,416 buildings runs.** Roads cover 24.6% of the planet's settlement ground (13,793 of 56,064
tiles).

The rule to build only on ground reachable from the centre cost 27 buildings: 3,443 before, 3,416
now, with the metropolises at 640, 732 and 737. The roads grew the save from 178 kB to 256 kB, and
the whole planet builds in 1.6 s.

## What went wrong

- **My first rule also switched off producers with no one to supply, and it was wrong.** It also
  idled any power, water or oxygen producer whose network drew none of its output. Every outpost's
  water extractors went dark: outposts house no one, yet filling the tanks is what they are for. The
  rule was also weak protection, since one cheap consumer next to a remote solar farm defeats it.
  Removed. The honest fix is stores per network (see Open).
- **The example first built in pockets no road could reach.** 23 buildings in one metropolis stood
  in ground walled off by steep slopes; its domes had no oxygen producer they could reach. The layout
  now builds only on ground connected to the centre over buildable tiles.
- **The levels-of-detail gates caught roads making medium detail 60% more expensive.** Medium
  went from 38,631 to 61,516 shapes fully zoomed out, mostly kerbs and connection points on every
  street. Kerbs, dashes, lamps and conduits are now high-only, which brings medium to 46,506.
- **Low's likeness to the full picture slipped to the test's limit** (45% of the bare-ground
  difference). A road up close is a dark surface plus kerbs, dashes and rovers, which reads 11%
  brighter than the bare surface. Far roads now take that measured colour: back to 40%, within 1%
  per channel.
- **One connection point per road tile** turned every street into a row of bollards. Now it is one per
  building side.
- **A 10-minute timeout on a 25-minute injection run.** I stopped the run before the limit could
  kill it mid-case, and that stop left `network.ts` still ignoring roads, the same failure as in
  Batch 24. The injection script now has a `repair` mode that checks every case's original text is
  present, and runs in chunks.
- **Four of the first 29 injections were missed:**
  - **The network cache ignoring roads.** Every test built a fresh layout, never the same buildings
    with new roads, which is what play does. The test now steps one world before and after its roads.
    Its first injection was also equivalent: it changed the lookup key but not the store key.
  - **Roads to connect crossing steep ground.** At the one test site, no shortest join needed to
    cross a slope. The example planet's ~13,800 roads are now each replayed through `placeRoad`.
  - **The view not refreshing when roads change.** The harness frame step was a second, past every
    refresh interval. A new test checks the next 16 ms frame.
  - **A lingering pointer laying road twice.** The drag never paused on a tile. It does now.
  
  All 29 are caught now, each by its own test.
- **Test fixtures that were wrong, not the code:**
  - one geothermal plant for 12 power of demand browned everything out: a shortage, not a
    missing connection;
  - the screen harness clicks as if every grid were 32 tiles, so outpost clicks landed elsewhere.

## Measured

The example's largest metropolis, now with its streets, viewed at 1600×900:

| Zoom | High | Medium | Low |
|---|---|---|---|
| 0.3 (fully out) | 266,310 shapes | 46,506 | 16,717 |
| 0.5 | 194,757 | 31,675 | 10,972 |

**Likeness at the widest zoom** (difference from high, over 8×8-pixel blocks):

| Picture | Difference from high |
|---|---|
| Bare ground (the yardstick) | 0.0238 |
| Medium | 0.0060 |
| Low | 0.0095 |

## Open

- **Stores per network.** The five stores are one pool per settlement, as §6 has them, so separate
  networks share a surplus. Each network must hold a producer of everything it draws, but a tiny
  one satisfies that rule while drawing on another network's output. The full model gives each
  network its own stores, split and merged as roads change.
- **Rovers ignore each other and junctions.** Each shuttles its own straight stretch.
- **A player's first buildings.** With the network on, a new settlement's buildings must share
  walls or roads from the start. The Build hint says so; the spaceport could come with a starter
  road.
