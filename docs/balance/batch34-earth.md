# Batch 34 - Earth: shipments, contracts and the market

Built unattended (`/next-batch auto`), one session, 2026-10-16.

## What went wrong, and what it cost

1. **Contracts sized in units were eight times harder at the Classic pace.** The first contracts
   asked for 150 to 300 materials, or 40 to 80 water, whatever the pace. The scripted trader
   accepted every materials offer, and in its first Classic hour it failed 23 and met none. Its
   reputation went to 0. At Standard it met 2 and failed none. The cause is the clocks. Launch
   windows follow the planet's calendar, and at Classic the planet runs eight times faster against
   the cities. So a window's span is 17.1 of a city's years at Standard and 2.1 at Classic, and a
   city makes an eighth as much between two windows. Contracts are now sized per city-year of a
   window's span (`EARTH_CONTRACT_MATERIALS_YEAR` 9, `EARTH_CONTRACT_WATER_YEAR` 2.4): 150 to 310
   materials at Standard, 20 to 40 at Classic. The real-time economy is the same at both paces:
   eight times the contracts, an eighth the size each. Research contracts were already in the
   planet's years. Measured after the fix, with the script accepting only what it can send at
   once: 3 met and none failed at Standard by the city of 1,000; 14 met and 1 failed at Classic.
   It cost two constants renamed, the manual's figures, and the scripted trader taught to look
   before it accepts.
2. **The scripted trader's first rule was greedy.** It took every materials offer, even with
   another under way and the store already spoken for by the build queue. At Standard it met 3 and
   failed 2 in two hours, and ended at reputation 40. It now takes a materials contract only when
   none is under way and the city could send all of it at once. On the same seed: 3 met, none
   failed, reputation 80. The script is an instrument. A greedy one would measure a player who
   ruins their own reputation, not the game.
3. **An offer in the alerts broke Batch 31's "a quiet, healthy city says nothing at all".** That
   test's 200 substeps saw three windows, and each offer was announced ("Earth offers a contract:
   ..."). The test was right: an offer comes every window, about every 9.5 minutes at Standard and
   71 seconds at Classic, and in the alerts it is noise. Offers are now shown by the Earth button
   ("Earth (an offer)", in the accent colour), and the alerts carry only what happened: a rocket
   home, a window missed, a contract met or failed. The test is unchanged.
4. **The bank balance was the wrong measure of trade.** The first pacing comparison read the bank
   at one hour: 375 credits with trade against 145 without. That understates it tenfold, because
   the scripted player spends its credits on the planet as they come in. Earth's own totals
   (2,595 credits from sales and contracts in the first hour at Standard) and the moments the
   credits buy sooner (Phase 2, 20.7 minutes sooner) are what is recorded below.
5. **The invariant #2 gate flagged the word "window".** The boundary test bans `window`, the
   browser's global, from simulation code. Comments are stripped first, but three refusal strings
   said "launch window". The gate is unchanged. The strings say "the launch windows" (plural) or
   "the launch" instead, so the singular word never appears in simulation code. It cost three
   reworded messages.
6. **A "measured" figure written before measuring.** The gate test's comment first gave the 50
   windows' worst lateness as "0.031 and 0.24 years" before the measurement existed. Measured, it
   is 0.030 and 0.245. Corrected before the commit.
7. **The test town emptied before the first window.** The first sim tests gave a founded city 300
   people and no homes. A city's people are capped by its housing, so it had nobody by the first
   window: no offer was dealt, and six of 24 tests failed for it. The town now has a dome, solar,
   a greenhouse and an extractor, and keeps 40 to 44 people (measured over 200 substeps).
8. **happy-dom does not select a `<select>`'s first option.** The panel left the city choice to
   the browser, so in the happy-dom harness no city was chosen and every order was refused. The
   panel now sets it explicitly: the one chosen if it still has a spaceport, else the first. That
   is right in a browser too.
9. **Two earlier tests needed Earth adding, and neither was weakened.**
   - Batch 33's v17-load test builds a pretend v17 save from today's world by stripping the fields
     newer than v17. Earth's v19 field must be stripped too. A world from before loads with Earth
     as a new world starts it, which the test now asserts.
   - The pinned mode overrides (`pace.test.ts`, `first-hour.test.ts`) list exactly what each mode
     adds. They now include `EARTH_ENABLED`, as Batch 33 added `DECISIONS_ENABLED`.
10. **Injections the tests did not see.** 54 faults were injected, one at a time; five got through on the first run.
    - **A sale that found nothing to send was closed** (9). The test only covered a window when
      the rocket did not fly. The sale is settled inside the rocket's loading, so the fault showed
      only when something else (a purchase) sent the rocket up. The test now has both.
    - **Orders were not saved** (37). The save test saved a world after its window, when every
      order had gone up, so there were none to lose. It now saves a purchase and a sale waiting.
    - **Contracts sized by Standard's clock at both paces** (43). The sim tests run at Standard
      pace, and the trading script at Classic accepts only what it can send, so 8x contracts went
      unnoticed. A test now bounds the dealt sizes at both paces: 150 to 310 materials and 40 to
      80 water at Standard; 20 to 40 and 10 at Classic.
    - **A contract failing a window early** (30) and **Earth stepping with Earth off** (35)
      changed nothing as written. Each sat behind a second check: `settleContracts` asks first
      whether anything is due, and `advance` only calls `stepEarth` with Earth on. Injected again
      as coherent faults - the window taken as the next one, and both guards removed - both were
      caught.

    Reading the code during the run turned up a gap no fault had probed. A save with a sale of
    settlers passed validation, and would have priced the sale at NaN credits at the window. It
    is refused on load now (fault 52).

## What was built

- **`src/sim/earth.ts`**, all inside `advance`, every substep (`stepEarth`, after the cities and
  the events):
  - **Windows.** Window k opens at the first substep on or after the planet's year k x 2.135
    (`windowStep`), from k alone.
  - **The rocket.** At a window each city's rocket flies: its first finished spaceport whose rocket
    is home. It goes up with the city's sales, then what the contracts can take, never a store
    below `EARTH_KEEP_SHARE` of its room. It is a rocket job on that spaceport carrying the
    flight's number (`earth`), so the view draws it, a supply run cannot take it, and it brings
    none of a supply run's materials. It lands `EARTH_TRIP_SHARE` of a window later, in whole
    substeps on the city's clock.
  - **Landing.** Goods take the room there is, and the rest is sold back at the window's price.
    Settlers take the empty homes, and those with none are refunded at what was paid. Rovers join
    the city's extra rovers.
  - **Missed windows.** A city with orders and no rocket to fly misses the window (a record), and
    its orders wait. A lost city's orders are refunded.
  - **The market.** Each good is priced at its base, times Earth's supply in that window (seeded,
    +-20%), times the trade the market remembers (+100% per 2,000 credits' worth, half forgotten
    each window), times reputation (+-25%). A purchase is priced at the middle of the order, so
    splitting it changes nothing. Earth pays 40% of its price, less the more it has been sold.
  - **Contracts.** One offer each window to a world with people: materials or water sized by a
    window's span, or research by the planet's research rate. Due three windows on. Accepted (an
    action), materials and water go up on the rockets, and research is diverted from the bank
    (`divertResearch`, in `advance`) until the contract is met. Met: the reward and +10
    reputation. Failed: -20.
  - **Unlocks.** Settlers are for sale after 1 contract met, rovers after 3.
  - **Actions.** `orderFromEarth`, `cancelEarthOrder` and `acceptContract`, each refusing with the
    reason. A purchase is paid when placed and refunded in full if cancelled.
- **Save v19.** `earth` (reputation, counts, the market's memory, orders, flights, offer,
  contracts, record, totals, the next id) and a rocket job's `earth`. A migration from v18 gives
  Earth as a world starts it. A corrupt record is refused by name.
- **31 tuning constants** (`EARTH_*`) in `tuning.ts` and the section 10 table. `validateTuning`
  refuses a trip as long as a window gap, and any tuning that would let Earth pay more than it
  asks.
- **The away summary** counts contracts met and failed, from Earth's counters (exact, however
  long the absence).
- **The Earth panel** (`src/web/earth.ts`, `earth-words.ts`), from the bar beside Statistics and
  Alerts. It shows:
  - reputation and the next window;
  - the bank and the trade so far;
  - prices, with locked goods saying what unlocks them;
  - an order form whose Buy and Sell are dry runs of the very action, disabled with the reason;
  - the room the city has, and what a rocket could send;
  - orders waiting, with Cancel, and rockets away, counting down;
  - Earth's offer with Accept, contracts under way with a meter, and the record.
- **Alerts** for a window missed and a contract failed (notices), a rocket home and a contract met
  (records). Each opens the Earth panel.
- **The spaceport's inspector** says what its rocket does with Earth, and when it is home.
- **`MODE_OVERRIDES`**: Standard and Terraformed worlds turn Earth on.
- **The pacing script's `trade`.** It sells materials over nine-tenths full down to half, and
  takes a materials contract it can send at once.

## Measurements

### Launch windows (the exit gate)

Measured through a real `advance` on the browser's new-world tuning. The chunks are blind to where
the windows fall: 17 substeps at Standard, 1 at Classic. A one-material order is always waiting,
so a rocket flies at each window and its launch is recorded.

| Pace | Substep (years) | Windows | Latest after its date | Mean gap over 49 | Real time between, at 1x | Trip |
|---|---|---|---|---|---|---|
| Standard | 0.03125 | 50 | 0.030 years | 2.1346 years | 569 s (9.5 min) | 23 substeps, 192 s |
| Classic | 0.25 | 50 | 0.245 years | 2.1327 years | 71 s | 3 substeps, 25 s |

Every launch is on or after its date and less than a substep after it. The first window comes 575
s (9 min 35 s) into a Standard world, 75 s into a Classic one.

### A contract met against the same run failed (the exit gate)

The world is the scripted Standard player's at 60 minutes. A materials contract dealt by the
tuned rule is put under way with the store full. The failed run is the same world with the
spaceport removed, so nothing can go up:

| | Credits | Reputation |
|---|---|---|
| Met | + the reward (`ceil(amount x 4)`), to 6 places | 60 (50 + 10) |
| Failed | the same, without it | 30 (50 - 20) |

### Earth changes nothing for a player who does not trade

The scripted Standard hour with Earth on and off is the same world to the bit: every moment, and
the whole state but Earth's own (`toEqual`). With Earth on, windows passed and an offer stood.

### The scripted player, trading or not (events off)

| | City of 1,000 | Phase 2 | First building, first upgrade | Contracts met / failed | Credits from sales / contracts |
|---|---|---|---|---|---|
| Standard, no trade | 2.16 h | 99.2 min | 33 s, 21.5 min | - | - |
| Standard, trades | 2.05 h | 78.5 min | 33 s, 21.5 min | 3 / 0 | 1,978 / 2,680 |
| Classic, no trade | 1.736 h | 12.4 min | 8 s, 19.9 min | - | - |
| Classic, trades | 1.743 h | 12.4 min | 8 s, 19.9 min | 14 / 1 | 3,750 / 1,680 |

With events on and answered as well, the trading Standard player's city of 1,000 came at 1.99 h.
At Classic, the materials sold cost the city 25 seconds. Phase 2 came at 12.4 minutes there,
before the first sale.

The targets were proposals before measuring and are met as measured:

- the first window inside the first ten minutes at Standard (9 min 35 s);
- trading not holding the city of 1,000 back (Standard 6.4 min sooner; Classic within 1%);
- trading bringing the planet on (Phase 2 20.7 min sooner at Standard).

### Prices

Base prices, a unit, as Earth asks:

- materials 4, water, food and oxygen 6;
- settlers 30, rovers 1,500.

Earth pays 40% of that. With supply at +-20% and reputation at +-25%, Earth's best price for a
good bought back is 0.6 of its base, and its cheapest asking is 0.6. That is break-even, and
`validateTuning` refuses anything past it. Measured on 60 windows' prices at full reputation, the
dearest offer for materials never exceeded the cheapest asking.

## Decisions (each taken as a bare "Go" would accept)

1. **Windows by the planet's calendar**, k x 2.135 of its years from year 0, the first at one
   period. The orbit is the planet's, and "by sim time" in the plan is the planet's time.
2. **The spaceport's own rocket carries the shipment both ways**, as a rocket job carrying the
   flight's number. The view draws it, the inspector reads it, and a supply run holds it, which
   is what makes a window missable. The trip is a third of a window (`EARTH_TRIP_SHARE` 0.33), so
   it is always home before the next.
3. **A purchase is paid when placed, refundable until it goes; a sale is paid as it goes up, at
   the window's prices.** Paying up front lets the market remember the order at once, and keeps a
   refused order refused for a reason the player can see.
4. **What does not fit is sold back; a settler with no home is refunded.** Cargo is never silently
   lost. The panel shows the room, so the sale-back is a consequence the player can see coming.
5. **A rocket never takes a store below a quarter of its room**, for a sale or a contract alike, so
   trade cannot starve a city of water, food or oxygen.
6. **One offer each window, dealt from the seed and the world as it stands, due three windows
   on**, standing until the next window. Research goes to Earth instead of the bank while its
   contract is open: credits later for credits now.
7. **The unlocks are Earth's goods**: settlers after 1 contract met, rovers after 3. They are things
   the player buys and sees land.
8. **Reputation moves prices only**, +-25% at the extremes, and failing costs twice what meeting
   gains (20 against 10). A contract is a risk worth weighing.
9. **On in new Standard and Terraformed worlds** (`MODE_OVERRIDES`), never in a sandbox (unlimited
   credits and materials) or a world made before. The free supply run (`launchRocket`) is
   unchanged; it holds the rocket.
10. **Earth's request (Batch 33's sixth event) is a contract, not an event card.**
11. **"The economy panel" is a panel of its own** from the bar, with the bank and the trade so far.
    The HUD's economy is one line of the orbit view, and trading is wanted from a city too.
12. **An offer is said by the Earth button, not the alerts** (above).

## Injection run

54 faults, one at a time. Each file was restored byte for byte, and `git status` was checked after
each one; the tree was clean at the end.

- 46 were caught at once.
- 3 were missed until a test was added or strengthened (9, 37, 43).
- 2 changed no behaviour as written (30, 35): a second guard held. Each was injected again as the
  coherent fault and caught.
- 1 was the save check added after the run (52), caught at once.

Test names are shortened.

| # | Fault | Caught by |
|---|---|---|
| 1 | a window rounded to the nearest substep, not the first on or after its date | opens window k at the first substep on or after year k x 2.135, worked; lands 50 windows on their dates, a classic-paced world |
| 2 | windows a whole number of substeps apart (drift) | opens window k at the first substep on or after year k x 2.135, worked; lands 50 windows on their dates, a classic-paced world |
| 3 | the trip a substep longer (rocket and flight both) | brings the rocket home before the next window, in whole substeps of the city's clock (the measured trip, 23 substeps, which the manual gives as 3 min 12 s) |
| 4 | the rocket job on the planet's clock, not the city's | brings the rocket home before the next window, in whole substeps of th; lifts off at the window with the orders, as the spaceport's rocket, an |
| 5 | Earth's shipment brings a supply run's materials too | lifts off at the window with the orders, as the spaceport's rocket, an |
| 6 | a spaceport still going up flies | does not fly from a spaceport still going up |
| 7 | a spaceport whose rocket is away flies | lifts off at the window with the orders, as the spaceport's rocket, an; misses a window its rocket is away for |
| 8 | a rocket takes a store to nothing (no keep) | fills a contract over several windows when one cannot carry it all; sends a sale up at the window - only what is above a quarter of the st |
| 9 | a sale that took nothing is closed | **missed**; caught after the test was added or strengthened: keeps a sale with nothing to send waiting for the next window, though  |
| 10 | orders not taken off when their rocket flies | sends a sale up at the window - only what is above a quarter of the st; lifts off at the window with the orders, as the spaceport's rocket, an |
| 11 | what does not fit is lost, not sold back | sells back what does not fit as it lands, refunds the settlers with no |
| 12 | settlers with no home are not refunded | sells back what does not fit as it lands, refunds the settlers with no |
| 13 | rovers bought never join the city | sells back what does not fit as it lands, refunds the settlers with no |
| 14 | a store filled past its room | sells back what does not fit as it lands, refunds the settlers with no |
| 15 | a purchase not charged | charges a purchase when it is placed, at the market's price, and refun; places an order through the simulation at the price on the button, lis |
| 16 | the market does not remember a purchase | charges a purchase when it is placed, at the market's price, and refun; costs the same bought in one order or in two, but for rounding up |
| 17 | priced at the first unit, not the order's middle | costs the same bought in one order or in two, but for rounding up |
| 18 | a cancelled purchase not refunded | charges a purchase when it is placed, at the market's price, and refun; places an order through the simulation at the price on the button, lis |
| 19 | settlers for sale from the start | refuses, changing nothing and saying why; disables what the world would refuse, with the reason |
| 20 | a purchase the bank cannot pay for allowed | refuses, changing nothing and saying why; disables what the world would refuse, with the reason |
| 21 | reputation does not move prices | moves each window with Earth's supply, drawn from the seed, and with t |
| 22 | Earth's supply the same every window | moves each window with Earth's supply, drawn from the seed, and with t |
| 23 | Earth's supply ignores the seed | moves each window with Earth's supply, drawn from the seed, and with t |
| 24 | the market never forgets | forgets EARTH_MARKET_RECOVERY of the trade it remembers at each window |
| 25 | research contracts offered with nothing earning research | offers one at each window once a city has people, dealt from the seed  |
| 26 | offers to a city with no one in it | offers one at each window once a city has people, dealt from the seed  |
| 27 | an offer never renewed | lets an offer not taken lapse at the next window, and takes one accept; at Classic, trading does not hold the city back |
| 28 | failing costs no reputation | fails one still short at its window: no pay, and the reputation falls; pays its reward and raises the reputation by EARTH_REP_FULFIL when met |
| 29 | a contract met is not paid | fills materials from what is above the keep at a window, pays when met; sends the planet's research to Earth instead of the bank until a resea |
| 30 | a contract fails a window early | **changes no behaviour as written** (a second guard holds); a contract fails a window early (the window taken as the next): fails one still short at its window: no pay, and the reputation falls |
| 31 | a contract takes a store to nothing | is the same world in one call and in ragged chunks, over windows, land; fills a contract over several windows when one cannot carry it all |
| 32 | research never sent to Earth | is the same world in one call and in ragged chunks, over windows, land; sends the planet's research to Earth instead of the bank until a resea |
| 33 | research sent and banked too | sends the planet's research to Earth instead of the bank until a resea |
| 34 | Earth stepped only on a call's first substep | is the same world in one call and in ragged chunks, over windows, land; refuses a corrupt record, by name |
| 35 | Earth steps with Earth off | **changes no behaviour as written** (a second guard holds); Earth steps with Earth off (both guards): changes nothing with Earth off, whatever is waiting; changes nothing for a player who does not trade |
| 36 | research diverted with Earth off | changes nothing with Earth off, whatever is waiting |
| 37 | orders not saved | **missed**; caught after the test was added or strengthened: saves and loads every part of it, a rocket away included, and carries  |
| 38 | a v18 world starts Earth at no reputation | loads a v18 save with Earth as a world starts it |
| 39 | the rocket's shipment number lost on loading | saves and loads every part of it, a rocket away included, and carries  |
| 40 | a missed window not recorded | does not fly from a spaceport still going up; misses a window its rocket is away for |
| 41 | a lost city's orders not refunded | refunds the orders of a city lost to the sea at the next window |
| 42 | no tuning check that Earth pays no more than it asks | never pays more than it asks |
| 43 | contracts sized in units, not by a window's span | **missed**; caught after the test was added or strengthened: asks for what a city makes in a window's span |
| 44 | Standard worlds without Earth | changes nothing for a player who does not trade; is off by default and in every world made before it; new Standard and  |
| 45 | the panel's Buy not disabled when refused | disables what the world would refuse, with the reason |
| 46 | a rocket going up announced | announces a rocket home, a window missed, a contract met or failed - n |
| 47 | Earth's past announced on opening a world | takes its bearings on opening a world |
| 48 | the game never updates the Earth panel | puts Earth in the bar, opens it in place of the alerts, and takes an o |
| 49 | the away line counts no contracts | tells a player coming back how many contracts were met and failed whil |
| 50 | the trading script takes contracts it cannot send | at Classic, trading does not hold the city back |
| 51 | the city chosen in the panel left to the browser | puts Earth in the bar, opens it in place of the alerts, and takes an o; disables what the world would refuse, with the reason |
| 52 | a sale of settlers accepted from a save (the check added after the run) | refuses a corrupt record, by name |

## Open

- **Choosing which city sends a contract's goods.** They go from whichever cities' rockets fly, in
  founding order. A player who wants to spare one city cannot. Batch 40's playtest.
- **A second spaceport** helps only when the first one's rocket is away: a city flies one rocket a
  window.
- **At Classic, an offer every 71 seconds.** The calendar is the planet's. Whether Classic should
  have fewer offers is a design question for Batch 40.
- **The statistics do not chart trade or reputation.** The planet's record (Batch 31) keeps neither.
- **An event's supply ship still loses the materials a full store cannot take** (Batch 33's open
  item). Earth's own rockets sell theirs back. Doing the same for the event would change Batch
  33's measured outcomes in worlds made between the two updates. Left for Batch 40.
- **Pay to hurry** (Batch 28's) was not built: Earth's market sells goods, not time.
- **Earth makes no sound**: Batch 35.
- **The Earth panel was checked only in the happy-dom harness**, not looked at. No rendered frame
  of the HUD exists in this project. Batch 40's playtest.
