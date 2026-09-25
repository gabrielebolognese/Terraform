# Detail pass: the city's later buildings

The user: "add the following structures: laboratory, algae reactor (gives oxygen), skyscraper (only in
cities with 1k+ people), astronomy observer (5x5 big structure, at 2k population), station (4x6),
creates railways, I can connect different zones of the city, at 5k population. Then also research
forum (4x6), that looks like a very big habitat dome, but it's like a bar and lab. Medical center
(very important: avoids that people die when there is a scarcity of oxygen/food, as people find
shelter here, 5x5, at 1k population), industrial command center (6x4): in a 15x15 radius at level 1,
it makes all the facilities in its radius work 10% more."

## What went wrong, and what it cost

- **Every building was square.** A 4 x 6 station needed a depth next to the footprint's width at 23
  places in the simulation and about 40 in the renderer and the web - occupancy, overlap, networks,
  rocks, floods, the save's checks, foundations, picking, the ghost, the red footprints, the
  connectors, the worksite, the example planet's layout. Two tests carried the same assumption (the
  example's spread test and the LOD colour test drew every building square) and failed on a
  correct 6 x 4 building until fixed.
- **Three roofs were painted the wrong colour.** Parts of one building are drawn in the order they
  are listed, and an accent band's top face, listed after the roof, was drawn over it: an orange
  command center, an orange station hall, a red medical center. Seen in a rendered sheet, not by any
  test; the bands are now their two visible sides only, as the foundations were already drawn. The
  first laboratory had the same fault the other way: its orange accent was the roof itself.
- **The far view drifted over its gate again** (city at low: 23.8% against 23.5%), from the
  metropolis's new mix of buildings as a whole - removing any one type left it at 23.5%. A tint for
  corridors that carry a cable at low detail, dropped last time as unproven, brought it to 22.9%;
  all four injections that gate catches are still caught.
- **Four test fixtures had no power** for what they tested (a mine "not connected" was simply browned
  out); one had more people than homes, so the housing clamp mixed with the deaths measured.
- **Two injections were masked**: a medical center "working without power" hid behind the rule that
  a power shortage shelters nobody anyway; "any building boards a train" hid behind the early exit
  for fewer than two stations, and behind the station check being made twice. Both tests widened.

## Built (tuning constants in `tuning.ts` and the section 10 table)

| Building | Size | People | Draws | Does |
| --- | --- | --- | --- | --- |
| Laboratory | 3 x 3 | - | power 3, water 1 | 12 credits/yr of research |
| Algae Reactor | 2 x 2 | - | power 2, water 1 | 5 oxygen/yr |
| Skyscraper | 2 x 2 | 1,000 | power 10, water/oxygen/food 7 | houses 160 |
| Astronomy Observatory | 5 x 5 | 2,000 | power 5 | 40 credits/yr |
| Station | 4 x 6 | 5,000 | power 4 | rails between stations join their networks |
| Research Forum | 4 x 6 | - | power 6, water 3, food 2 | 30 credits/yr; city growth x1.25 |
| Medical Center | 5 x 5 | 1,000 | power 4, water 2 | shelters 400 from dying while oxygen or food is short |
| Industrial Command Center | 6 x 4 | - | power 5 | facilities in its square make 10% more |

- **Research** is income: the settlements' research reaches the planet's economy each substep
  (with `ECONOMY_ENABLED`). Levels and the command center raise it like any output.
- **Railways** are a third tile layer, laid with a new tool at the top right (2 materials a tile).
  Two stations on one line - rail tiles touching each - join the corridor and cable networks round
  them. Only stations board a line.
- **Medical centers** shelter only from oxygen and food shortages: short of power or water they
  cannot run, and save no one.
- **The command center's square** is 15 tiles a side about its middle at level 1, two more each
  level; a building counts if its middle lies in it. Two centers do not stack.
- A card whose building the city cannot yet have says "at 1,000 people"; its tooltip gives the size,
  the research and the people needed.
- The example planet's larger cities have laboratories, algae reactors and a command center; its
  metropolises skyscrapers, an observatory, a research forum and medical centers - all supplied,
  all running.

## Open

- The example planet lays no railways yet (its largest metropolis can build stations).
- Railways carry no train yet: the line is drawn, not animated.

## Measured

- 12 + 4 injections, all caught (two after widening their tests).
