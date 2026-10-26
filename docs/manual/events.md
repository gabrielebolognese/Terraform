# Events and decisions

Things go wrong on Mars, and sometimes something good turns up. From about half an hour into a
new world, events come to your cities: a meteor shower, a machine about to fail, a sickness, Earth's
supply ship, a find in the rocks. Each one gives you a few choices and a time limit. What you
choose, and what it costs, is up to you. If you do nothing, the worst happens.

Events come to **Standard** and **Terraformed start** worlds made from Update 33 on. A **Sandbox**
has none, and worlds made before this update have none either.

## When events come

- No event comes in the first 30 minutes of a new Standard world, at 1x. A Terraformed start
  begins with its planet already old, so its events can come from the start.
- From then on, each 20 minutes of play has a three-in-four chance of an event: about one every
  25 minutes on average. Which events come, and when, is set by your world's seed: two worlds
  made from the same seed meet the same events at the same moments, if their cities are the same.
- Each event falls on one of your cities that has people in it.
- You have **about 3 minutes at 1x** to decide (a minute and a half at 2x, one minute at 3x). The
  game paused, the clock stops too.

## The event card

When an event comes, a card opens at the top left of the screen (in a city, below the tool bar),
and an urgent alert pops up with its sound. The card shows:

- **What happened and where**, for example "Meteor shower in Ares".
- **Decide within** and the time left.
- **Each choice**: what it costs and what it does, with the event's own numbers. A choice you
  cannot pay for is greyed out and says why, for example "Cannot: it needs 150 credits; the bank
  holds 40."
- **If you do nothing**: what happens when the time runs out with no choice made. It is always
  worse than at least one of the choices.
- **Show** *city*: takes you down to the city (for a failing machine, with it selected).

Click a choice to take it. You pay its cost at once, and you cannot change your mind. The card then
says **Decided** and counts down to the moment it happens. **Everything happens when the time
runs out**: the shower arrives, the machine fails, the ship lands. **Hide** folds the card away;
**Show** brings it back.

## The events

### Meteor shower

A shower is on its way to the city.

| Choice | Cost | What happens |
|---|---|---|
| **Take shelter** | Free | Nothing is hit. The city makes no materials and earns no research for about a minute. |
| **Raise the shields** | 150 credits | Nothing is hit, and work goes on. |
| **Keep working** | Free | 3 hits. Each takes a building down a level, and a building at level 1 is wrecked. |
| *Do nothing* | | 6 hits: the 3 of keeping working and as many more. |

A meteor never hits the Headquarters or a building still going up. A wrecked building is gone, as
if you had removed it: a rover building or upgrading it comes home, and anything paid for a build
still waiting is refunded. The same building can be hit twice.

For a small city, sheltering usually costs least. A big city makes a lot of materials in a minute,
and a few hits may matter less to it.

### A machine failing

A building that makes power, water, oxygen or food (or the Spaceport, which brings them from
Earth) has a fault. The card names it, for example "Solar Array failing in Ares".

| Choice | Cost | What happens |
|---|---|---|
| **Repair it** | Half the building's cost, times its level, in materials | It runs as before. |
| **Run it degraded** | Free | It makes half its output for 10 minutes. |
| *Do nothing* | | It breaks down: offline for 10 minutes. |

Select the building to see its fault: "A fault: it makes 50% of its output, for about 10 min at
1x", or, broken down, "Broken down: an equipment failure nobody saw to." A broken-down machine
can leave the city short of what it made.

### Outbreak

A sickness spreads in a city of 200 people or more. The card says how many people are at risk:
one in ten of the people the city's **Medical Centers** cannot shelter. Each Medical Center
shelters 400 people, more at higher levels, so a city with enough of them has few or none at
risk.

| Choice | Cost | What happens |
|---|---|---|
| **Treat everyone** | 5 credits for each person at risk | A fifth of those at risk are lost. |
| **Quarantine** | Free | Half of those at risk are lost, and the city does not grow for 5 minutes. |
| *Do nothing* | | Everyone at risk is lost, and the city does not grow for 5 minutes. |

### Earth's supply ship

A ship from Earth is bound for the city with 150 materials and 20 settlers. Each lands only as the
city has room: materials that do not fit in its stores, and settlers without a home, are lost.
The ship comes one of three ways:

**Early** (two times in five) - the landing pad is not ready.

| Choice | Cost | What happens |
|---|---|---|
| **Land it rough** | Free | Three quarters of the cargo lands. |
| **Clear the pad** | 30 materials | All of it lands. |
| *Do nothing* | | Half of it lands. |

**Late** (two times in five) - the cargo will not keep for ever.

| Choice | Cost | What happens |
|---|---|---|
| **Pay to rush it** | 100 credits | All of it lands. |
| **Wait for it** | Free | Half of it lands; the rest spoils. |
| *Do nothing* | | A quarter of it lands. |

**Lost** (one time in five) - contact with the ship is lost.

| Choice | Cost | What happens |
|---|---|---|
| **Search for it** | 100 credits | Half of it is found and lands. |
| **Write it off** | Free | Earth's insurance pays 60 credits. |
| *Do nothing* | | Nothing. |

### A discovery

The rovers find something in the rocks: a vein of ancient ice, a meteorite, or traces of
something that might once have been alive.

| Choice | Cost | What happens |
|---|---|---|
| **Study it** | 100 credits | The research earns 400 credits. |
| **Sell the samples to Earth** | Free | Earth pays 150 credits. |
| *Do nothing* | | The find is left where it lies. |

## What an event leaves behind

Some choices last a while after the moment they happen. The city's status line says so:

- "Its people are under cover: no materials made or research earned for about 1 min at 1x."
- "In quarantine: no growth for about 5 min at 1x."

A machine with a fault says so when you select it (see above).

## Alerts and the event history

- An event waiting for you is an **urgent** alert. It pops up once when the event comes and stays
  under **Now** in **Alerts** until you choose.
- When an event happens, **What happened** in **Alerts** says what you chose and what it did, for
  example "Meteor shower in Ares: Kept working: 3 buildings hit, 2 wrecked." If you chose nothing,
  it pops up as a notice.
- **Event history**, at the bottom of **Alerts**, lists every event your world has had (the
  latest 40), newest first, marked **Decided** or **Missed**. It is kept with your world, so it
  is still there after you close and reopen it. Click a line to go to the city.

## While you are away

Events keep coming while the game is closed, as everything else does, and nobody is there to
answer them: each one comes to its worst. An event you decided before you left still happens as
you chose. When you come back, the **While you were away** summary says how many events came and
how many went unanswered, and **Event history** lists them.
