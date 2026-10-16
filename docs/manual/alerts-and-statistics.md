# Alerts and statistics

The game tells you when something needs you, and keeps a record of how your planet and cities
have done.

## Alerts

When something goes wrong or something you started is done, the game tells you. Every alert
names its place, and clicking it takes you there.

| Alert | What it means | How it shows |
|---|---|---|
| **Blackout in** *city* | The city's power has run short. It says how many buildings are dark for it | Urgent: a pop-up message |
| *City* **is short of water / oxygen / food** | People are going without | Urgent: a pop-up message |
| *City* **is short of materials** | Buildings that use materials go without | A pop-up message |
| *Buildings* **offline in** *city* | Buildings that cannot run, and why: not connected to what they need (and what to lay), or the planet does not allow them yet | A pop-up message |
| **A dust storm is coming** | A storm will rise in about two minutes, and how long it will last. A storm cools the planet while it lasts | A pop-up message |
| *Building* **finished in** *city* | A new building is up | Kept in **Alerts** only |
| *Building* **raised to level** *N* **in** *city* | An upgrade is done | Kept in **Alerts** only |
| **Objective done:** *name* | Its reward is waiting in **Objectives** | Kept in **Alerts** only (the milestone card already shows it) |
| *Event* **in** *city*, waiting | An event needs your decision: a meteor shower, a machine failing, an outbreak, a supply ship, a discovery. It says how long you have | Urgent: a pop-up message, and under **Now** until you choose |
| *Event* **in** *city*, happened | What you chose and what it did, for example "Kept working: 3 buildings hit, 2 wrecked" | Kept in **Alerts**; a pop-up message if you chose nothing |
| **Launch window missed in** *city* | Its rocket was away, or it has no finished Spaceport: its orders for Earth wait for the next window | A pop-up message |
| **Earth's** *materials* **contract failed** | A contract was not met by its launch window: your reputation with Earth falls | A pop-up message |
| **Rocket home in** *city* | Earth's rocket landed, and what it brought | Kept in **Alerts** only |
| **Earth's** *materials* **contract met** | What Earth paid, and the reputation gained | Kept in **Alerts** only |

Many of the same thing in one place are one alert: a hundred greenhouses offline for the same
reason in one city are a single line, "100 Greenhouses offline in Ares". Buildings dark because power or
another supply ran short are counted in that shortage's alert, not listed again.

### Pop-up messages

Urgent and notice alerts pop up at the top right of the screen as they happen, up to three at a
time, the urgent ones first. An urgent message stays about 12 seconds and a notice about
6 seconds. Click a message to go where it happened, or **x** to dismiss it.

A problem that clears and comes back within a minute does not pop up again: a store right at its
limit can flicker short and back.

### The Alerts button

**Alerts** sits beside **Menu**: at the bottom right in orbit, and at the top right in a city. It
shows how many things need you now, for example **Alerts (3)**, and turns red while one of them
is urgent. Press it to see:

- **Now**: everything that holds at this moment, the most pressing first.
- **What happened**: everything since you opened the world, newest first, with the year it
  happened. The same thing again in one place, one after another, counts up on one line: "Habitat
  Dome finished in Ares (3 times)".
- **Event history**: every event your world has had (the latest 40), newest first, each marked
  **Decided** or **Missed**, with the year and what it did. Unlike **What happened**, it is kept
  with your world and is still there after you reopen it. See [Events and decisions](events.md).

Click any line to go there:

- **A city's alert** takes you down to the city, selects the building, and brings it to the middle
  of the view. If you are already in that city, it selects the building at once.
- **A storm** takes you back up to the planet.
- **An objective** opens **Objectives**.
- **An event** takes you down to its city; for a failing machine, with the machine selected.
- **Earth's** alerts open **Earth**. See [Earth](earth.md).

When you open a world, anything already wrong is listed under **Now** but does not pop up.
**What happened** starts fresh each time you open a world.

## Statistics

Press **Statistics**, beside **Alerts**, to see charts from any view. Choose whose record from the
list at the top:

- **The planet**: temperature, pressure, oxygen, the share of the surface under water, biomass,
  carbon dioxide, progress, your credits, and the people in all your settlements. The record runs
  from when your world began (or from when you first opened it after this update) to now. It takes
  a reading about every half minute at 1x, and spreads them out as the game goes on, so the whole
  game always fits.
- **Each city**: its population and homes, people born and lost, its shortages, its stores, what
  it makes less what it uses, and, for each of power, water, oxygen, food and materials, what it
  made and what it used. The power chart is the city's power balance. A city's charts cover its
  last 150 years, about 80 minutes of play at 1x. The made and used charts begin with this update.

Each chart's key gives every line's latest value. Press **Close** to go back. The same city charts
are in the city planner's **Charts** tab.

## Each city at a glance

In orbit, each city in the **Settlements** list has a line saying how it is doing, for example:

> 120 of 160 people - short of water - 2 going up, 1 waiting for a rover

That is its people against its homes, what is running short (in amber when something is), and
what is being built: new buildings going up, upgrades under way, and builds waiting for a free
rover. Choose a settlement on the **World map** to see the same line in its panel.
