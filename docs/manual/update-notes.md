# Update notes

What is new, changed and fixed in each update, newest first.

---

## Update 29 - Vehicles that use the city

Rovers and trains no longer pass through buildings. Rovers drive real routes round your city, and
the route sets how long a job takes. Trains run on a track each way and stop at stations.

**New**
- **Rovers drive round the city.** A rover leaves by the Headquarters' garage door and drives
  over corridors and open ground to its job. It never goes under a building, over a crag or up
  ground too steep to build on. It turns where its way turns and keeps behind another rover on the
  same stretch.
- **Corridors are roads.** A rover drives along a corridor twice as fast as over open ground.
- **The route sets the trip.** Each tile of open ground on the way takes a rover about half a
  second at 1x, out and again home, on top of the work itself.
- **A track each way.** Each way of a city railway has its own track, drawn as a double track
  that curves round bends. Trains ride the curve car by car and slow down for bends. They stop for
  about 4 seconds at a Station's platform and at the end of a line, then run back.
- **Maglevs and freight.** A railway that runs past a Station carries white maglevs. One that runs
  past none carries freight: an orange locomotive pulling wagons stacked with containers.

**Changed**
- **New rules for placing buildings,** in worlds made from this update on:
  - a building no rover can get to is refused ("no rover can get there from the garage");
  - so is one that would wall other buildings in, and the message says how many;
  - the ground just in front of the garage door is kept clear;
  - nothing can go up on a rover's way until that rover is home again.
- A rock, a patch of ground to level, or an upgrade that no rover can get to is refused the same
  way.
- In a city packed edge to edge, rovers drive long ways round, so builds there take longer than
  before. Leave gaps between buildings, or lay corridors.
- Worlds made before this update keep their old trip times and placing rules, but their rovers are
  drawn driving round the buildings too.

**Fixed**
- Rovers and trains no longer drive through buildings.
- A rover or train passing behind a building is now hidden by it, not drawn over it.
- Trains going opposite ways along a line no longer pass through each other.

**Known issues**
- Trains on different lines still pass through each other where the lines cross.
- A rover driving past another one at work beside its site can pass through it.

---

## Update 28 - Time that means something

Building now takes real time. Small structures still go up in seconds, but bigger ones and higher
levels take minutes and then hours, and the work carries on while the game is closed.

**New**
- **Real build times.** From about 20 seconds for a Storage Depot to an hour for a Mega Mall at
  level 1, and longer at every level: a Mega Mall at its top level takes about 8 hours.
- **The Standard pace** for new worlds: the planet itself changes more slowly, over days of play,
  while your cities keep their quick rhythm. A supply rocket's trip is still about a minute.
- **The Classic pace**, the fast game from before, is still there when you make a world.
- **The build queue.** When every rover is busy, new builds and upgrades wait in line, already
  paid for, and a rover takes the next one when it is free. Reorder them with **Up** and **Down**,
  or **Cancel** for a full refund. More Rover Posts mean more builds at once.
- **Countdowns everywhere:** above every worksite, in the city's **Builds** list, in the building
  panel, on the **Upgrade** button, and on the build cards.
- **Builds finish while you are away**, up to 10 hours, and the **While you were away** summary
  says what your cities finished.

**Changed**
- Speeds at the Standard pace are **pause, 1x, 2x and 3x**. Sandbox worlds have every speed.
- Every world made before this update plays at the Classic pace, exactly as before.
- Building with every rover out now queues the job instead of refusing it.

**Known issues**
- An upgrade costs as much as a new building, so early on it is usually better to build new.

---

## Update 27 - The front door

The game now has a title screen and keeps as many worlds as you like.

**New**
- **A title screen** with Continue, Worlds, New world, Example planet, Settings and Credits.
- **Worlds**, each with its own save: play, rename, duplicate, export, import and delete them.
- **New world** with a name, a **seed** (the same seed always makes the same planet), and three
  modes: **Standard**, **Sandbox** (unlimited everything) and **Terraformed start** (a living
  planet with cities already built).
- **A game menu** (Menu or Esc) to save, or save and quit to the title screen.

**Changed**
- Your planet from before this update is kept as a world called "My planet".

**Fixed**
- A world whose save cannot be read is kept as it is and never saved over.

---

## Update 26 - Structures with character

**Changed**
- Every building is drawn with its own details, varied a little from one to the next, so cities
  look built rather than stamped out.

---

## Before Update 26

The foundations of the game: a planet that terraforms through six phases; the machines you order
from orbit; credits and research; dust storms and comet impacts; cities and outposts with
buildings, levels, connections, rovers, rockets, people and land; the city planner; the world map
and railways between settlements; and the Example planet.

---

## Known issues in the current game

- **Reset planet** in the Instruments drawer starts the planet over at once, with no
  confirmation, and saves it that way.
- In a city, a right click also places or selects, the same as a left click.
- The **While you were away** summary only appears in the Instruments drawer.
- The ocean cover bar's minimum mark says "0.3%" when it means 30%.
- **Settings** are not available yet.
- There is no ending yet: the game carries on after the planet becomes a Living world.
- In a city, trains on different lines pass through each other where the lines cross.
- A rover driving past another one at work beside its site can pass through it.
