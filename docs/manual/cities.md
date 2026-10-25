# Cities

Cities are where people live on Mars. You found them from orbit, then go down and build them up
one structure at a time.

## Founding a settlement

In orbit, open the **Settlements** section. Type a name if you like, then press:

- **Found a city** - a place for people to live. It lands with a **Headquarters** and a
  **Spaceport**.
- **Found an outpost** - a smaller working base with no residents. It lands with a Headquarters
  only, and some buildings (homes, farms, the largest structures) are for cities only.
- **Found a metropolis** - a city with three times a city's ground each way. The button appears
  once you claim the objective "A city of 1,000" (see [Goals](goals.md)), and in every Sandbox
  world.

Then click the planet where it should stand; the line under the cursor shows the place and its
height. **Esc** or **Cancel** stops founding. Founding is free, and you can have as many
settlements as you like.

To go down to a settlement, press **Open** beside it, click its marker on the planet and choose
**Go down**, or use **Open the city** on the world map. **Back to orbit** brings you back up. The
world keeps running the whole time.

## Time in a city

Cities run on their own, faster clock: a year in a city passes in about half a minute at 1x. The
"per year" figures you see in a city are city years.

## The city screen

- **The top line** shows the city's size (Small, Medium or Large city, Metropolis, or Outpost),
  where it is, and how high it stands.
- **The status line** says how many people are housed and whether every need is met, or what is
  short ("Short of power, water - buildings that use it are browned out"). In a world made from
  Update 32 on it says "Life support is met", and the **People** section below it shows the
  people's happiness and their other needs (see [People and their needs](people.md)).
- **Stores** shows Power, Water, Oxygen, Food and Materials: how much you have, how much room
  there is, and whether each is rising or falling.
- **Builds** lists everything being built or upgraded, with a countdown, and what is waiting for a
  rover.
- **The build bar** along the bottom holds a card for every structure you can place. Hover over a
  card for what it does, what it uses and makes, its size and cost, and how long it takes to build.
- **The tools** at the top right lay corridors, power cables and railways, claim land, and level
  ground.

Click any building to select it. The panel that opens says what it is doing, and has buttons to
**Upgrade**, **Remove** or **Close** (and **Launch rocket** for a Spaceport).

## Building

1. **Pick a card** from the build bar and **click the ground** where it should go. A card marked
   *not enough materials* or with a requirement ("at 1,000 people", "at 300 mbar",
   "when terraformed") cannot be placed yet.
2. **Materials are paid at once.** A building needs ground your city holds, fairly flat ground,
   no rock or corridor in the way, and a way for a rover to get to it (see below).
3. **A rover drives out and builds it.** A worksite shows a countdown floating above it. The
   building does nothing until it is finished.

While a card is picked, the footprint under the cursor is red where the building cannot go.
Clicking there says why, for example "Cannot build: Habitat Dome: no rover can get there from the
garage".

Build times at the Standard pace start small and grow with size: about 20 seconds for a Storage
Depot, 30 seconds for a Solar Array, 2 minutes for a Habitat Dome, 15 minutes for a Spaceport, an
hour for a Mega Mall. The rover's drive there and back adds to it (see below). See
[Buildings](buildings.md) for every structure.

**Removing** a building is free but gives no materials back.

## Rovers and the build queue

Your Headquarters keeps **3 rovers**. Each **Rover Post** adds one more; you may have one Rover
Post for every 100 people. The objective "A town of 500" gives your largest city **2 more rovers**
for good.

When every rover is busy, a new build or upgrade is not refused: it **waits in the queue**,
already paid for, and a rover takes it as soon as one comes home. In the **Builds** list:

- **Up** and **Down** change the order of waiting jobs,
- **Cancel** removes a waiting job and gives back everything it cost.

A waiting worksite shows "waiting" above it. Removing a building that is still waiting for its
rover also refunds it in full.

Rovers do other work too:
- **Rocks.** Click a rock and press **Send rover**. Loose rocks break in a few seconds for 1
  material; a crag (a big outcrop that blocks building) takes longer and gives 5.
- **Level ground** (top right) sends a rover to flatten ground for tidier building.

## How rovers drive

A rover leaves by the garage door at the front of the Headquarters and drives to its job. It
drives over corridors and over open ground your city holds, turning where its way turns. It never
goes under a building, over a crag, or up ground too steep to build on, and it never squeezes
between two buildings that only touch at a corner. When two rovers drive the same stretch, the
second keeps behind the first. At the site the rover stops beside the work, its drill arm
hammering, then drives home.

**The route sets the time.** Over open ground a rover takes about half a second a tile at 1x;
along a corridor, twice as fast. That is each way, on top of the work itself. In a city packed edge
to edge, rovers drive long ways round, so leave streets between your buildings or lay corridors
where they drive most.

**Keeping the way open.** So that every building stays one a rover can reach:

- a building no rover can get to is refused: "no rover can get there from the garage -
  buildings, hard rock or ground too steep are in the way";
- a building that would wall other buildings in is refused, and the message says how many:
  "it would wall in 2 buildings no rover could get to then - leave a way through";
- the garage door, and the tile just in front of it, stay clear;
- nothing can go up on a rover's way until that rover is home again: "a rover is driving through
  there - wait for it to pass".

A rock, ground to level, or an upgrade that no rover can get to is refused the same way.

In a world made before Update 29, trips keep their old times and these rules do not apply, but
its rovers are still drawn driving round the buildings.

## Upgrades

Select a building and press **Upgrade to level N**; the button shows the cost and the time.

- An upgrade costs the building's full price again, at every level.
- Each level makes the building 10% better than the last: more output, more housing, more room.
  What it uses stays the same.
- Each level takes longer to build than the one before: a Storage Depot takes 20 seconds at
  level 1 and about 20 minutes at level 8; a Mega Mall takes an hour at level 1 and about 8 hours
  at its top level.
- The building keeps working while it is upgraded.
- Most buildings go up to level 8; a Habitat Dome to 5; a Regolith Mine to 10.

## Connections

A building only runs when it is connected to a working source of everything it uses.

- Buildings that touch are connected.
- **Corridor** (1 material a tile) carries water, oxygen, food and materials.
- **Power cable** (1 material a tile) carries power.
- **Connect all** and **Connect twice** lay the links for you.

Drag to lay a line; start a drag on an existing link to remove links instead. When a building is
not connected, its panel says what is missing, for example "Not connected: ... Lay a power cable
to a power plant."

## People

People arrive once there is housing and every need is met: **power, water, oxygen and food**. The
first settlers come in a small group, then the city grows steadily toward the housing you have
built.

If any of the four runs short, buildings that use it brown out and stop, and people start to
leave or die. Keep a margin, and build storage so a short gap does not hurt.

In a world made from Update 32 on, a growing city also wants green space and varied food from 500
people, medical care and research from 2,000, transport from 5,000 and shops from 10,000.
Services in reach of the homes make people happier, and a happy city grows faster and works
better. See [People and their needs](people.md).

## Land

A city starts on a patch of ground around its Headquarters. At **200 people** it can claim a new
square of land next to what it holds, and one more for every 100 people after that. Press
**Claim land**, then click where to grow. Claiming is free; outposts cannot claim land.

## The Spaceport and rockets

Select a Spaceport and press **Launch rocket**: a supply rocket flies off and comes back in about
a minute with 20 materials, or as many as you have room for. Each Spaceport flies one rocket at a
time. A Spaceport also brings in a trickle of materials, water, oxygen and food on its own.

## The city planner

**City planner** opens a map of the city for planning ahead:

- **Paint zone** and **Erase zone** mark areas in eight colours. **Level it** sends rovers to level
  a whole zone.
- **Road (corridor)**, **Power line** and **Railway** draw plans that crews build as materials
  allow. **Cancel plans** drops plans not yet built.
- You can rename the city here.
- **Charts** show population, growth and deaths, shortages, stores, what the city makes less what
  it uses, and, for each of power, water, oxygen, food and materials, what it made and what it
  used, year by year. The same charts are in **Statistics** (see
  [Alerts and statistics](alerts-and-statistics.md)).
- **Coverage** (in a world made from Update 32 on) shows where a service reaches: choose **Green
  space**, **Medical care**, **Research**, **Transport** or **Shops** to see the homes it reaches in
  green and the homes nothing reaches in red. **Overview** lists the city's happiness and each
  need. See [People and their needs](people.md#seeing-it).

## The world map and railways

**World map** shows the whole planet flat, with every settlement. Click a settlement to see it,
how it is doing (its people, anything running short, and what is being built), and its railways.

- **Lay a railway to...** then choose another settlement to connect them. A railway costs 5
  materials a kilometre, half paid by each end.
- A railway carries up to 300 a year each way of water, oxygen, food and materials, evening out
  the two ends' stores. It does not carry power.
- **Open the city** goes down to the selected settlement.

Inside a city, the **Railway** tool (2 materials a tile) lays track, and a **Station** joins
districts of a large city into one network.

Trains run on the railways inside a city. Each way along a line has its own track, so the track
is drawn double and curves round bends. A train goes straight on where two lines cross and turns
back at the end of a line. It slows down for bends, and stands for about 4 seconds at a Station's
platform and at the end of a line. A line that passes a Station carries white maglevs, which float
over the track. A line that passes none carries freight: an orange locomotive pulling wagons
stacked with containers.

## Example cities

The Example planet and a Terraformed start come with cities already built, including
metropolises - huge cities spread over many districts. Their homes have parks, medical centers,
laboratories, stations and malls among them, so in a Terraformed start their people are happy;
only their Stations, which stand by the railways, reach fewer homes than the rest. You can found a metropolis yourself once
you claim the objective "A city of 1,000", or in a Sandbox world.
