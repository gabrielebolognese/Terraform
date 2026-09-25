# Detail pass: the example planet's cities, in zones

The user: "change the cities in the sample world, they are all cramped right now, but add zoning: so
mining zones, habitat zones, solar panel zones, some mixed of any type, a port zone with for example 4
spaceports lined up, all interconnected, not cramped up. Things at the corners, and things at the
center, decentralized, visually pleasing. With powerlines and corridors done."

## What went wrong, and what it cost

- **"Connect all" laid links on hard rock.** Building the zoned cities on the browser's tuning
  (clusters on) exposed it: `linksToConnect` routed round cliffs but not round the hard-rock
  clusters added two passes ago, so it laid tiles `placeLink` refuses - in the game, "connect all"
  would have put 12 tiles on rock at one site. A test was written first and failed (12 tiles on
  rock); the route now goes round hard rock.
- **The example took 14 s to build** (it was under a second on 32-tile grids). 71% was joining power
  cables one building at a time, a whole-grid search each (858 on a metropolis). Cables now run along
  the streets with the corridors, as utilities do, and only the districts are joined; the cluster
  lookup kept the last site instead of building a key per tile. 3.0 s now - the browser's banner says
  "Building the example planet..." first, and its comment no longer claims under a second.
- **The level-of-detail gate failed, and the gate was measuring the wrong thing for this city.** Over
  the whole frame, the far views differed from full detail by 64% of what the buildings change (gates
  40%, 45%). The absolute error had not grown (0.013 at medium, before and after); a spread-out city
  changes half as much of the frame, so the same ground error became twice the share. Split in two:
  the city's own blocks against its own bare ground (medium 18.3%, low 22.6%; the old dense layout
  17%, 18% - gates 20% and 23.5%), and the ground and world round it as an absolute difference
  (0.0056, 0.0058; gate 0.009). Four injections prove it: the world in 8-tile cells (0.0205), no
  cable terminals at medium (23%), corridors as a flat trace at low (24.8% - my first 25% gate let it
  through), buildings in ground colour at low. One real improvement came of it: cable terminals,
  thousands of them now that cables ring every building, are drawn at medium (city error 0.64 -> 0.55
  of the old whole-frame measure). A tint for cabled corridors at low bought one point and was
  dropped, with a lone cable at low: an earlier decision, tested, that it is too thin to see.

## Built

- Five zones: homes (domes, greenhouses), power (solar, geothermal, reactors), industry (mines, water,
  depots, rover posts), a port, and mixed districts - every fourth of each kind goes to a mixed one.
- Districts anchored from the centre to the corners and edges, by size: a small city keeps them close;
  a city of 10+ homes reaches its corners; a metropolis has 15 districts. Each building goes on the
  reachable, open ground nearest its district's middle, with a 2-tile street round it.
- The port: 4 spaceports in one line (6 in a metropolis), each with a geothermal plant to power it,
  for every city of 4+ homes. Rover posts: one per 100 people the city holds, up to 4.
- Corridors and power lines on every street, and trunk lines joining the districts.

## Measured

- Of each building's 4 nearest neighbours, 74-85% are of its own kind (a random mix: 30%).
- Every city of 4+ homes has buildings in its centre and in 3 or 4 of its corners; no two buildings
  closer than 2 tiles (but the headquarters and the spaceport it lands with).
- 6 to 1,068 buildings; the metropolises 648, 858 and 1,068 (4,269 in all).
- Every city supported, every building running, every link layable by hand (replayed).
- Injections caught: everything mixed (0.32), the port not in a line, 1-tile streets, all districts at
  the centre, links over hard rock.
