# Batch 19 — Micro: settlement save schema + offline progression

Micro doc §12 step 3: *"Wire the save schema (section 10) and prove offline progression on a
settlement."*

**What was built:**
- save schema **v5**, which now stores each settlement's population, five stores and buildings;
- a v4 → v5 migration;
- hostile-save handling for every new field;
- 11 exit-gate tests in `src/sim/micro/settlement-save.test.ts`.

**Exit gate met, and checked by injection.** 674 tests pass, up from 663. Settlements are still off
by default, so the golden run, golden frames, Batch 3 score and determinism are unchanged.

## Decisions taken (defaults, on a bare "go")

1. **Capacities and grid size are not saved**, although §10's example saves both. Both are derived:
   capacities from the buildings plus the tuning, and grid size from the settlement kind plus the
   tuning. Storing them would bake in stale numbers, and the doc's own note under §10 forbids that
   ("never store derived values"). The plan's bullet said "this batch adds stores, capacities,
   buildings and the grid"; I followed the doc's rule over its example. A test pins the saved key
   set.
2. **A save is refused only for what can't be meant, and anything a retune could change is clamped
   or kept.** This is Batch 14's rule, applied to the new fields:
   - **Refused, with the field named:** an unknown building type, a building off whole tiles, a
     level below 1 or not a whole number, two buildings on the same tile, a negative store or
     population, or a missing field.
   - **Clamped:** stores above today's capacity, and population above today's housing.
   - **Kept:** a building off a grid a retune shrank, or a building in a kind of settlement a later
     build forbids. The simulation doesn't care where a building stands, and dropping it would
     destroy what the player built.
3. **The browser still leaves settlements off.** It opts in with Batch 20, which gives it a way to
   place buildings.

## What went wrong

**The first hostile-save message didn't name the value.** An unknown building type was reported as
`buildings[0].type string is not a known building`: the save's `describe()` helper reports the JSON
type, not the value. The test expected `"castle"` and failed. I fixed the message rather than the
test, so it now quotes the string. It was cheap, but it's the second time `describe()` has hidden
the bad value; other call sites may deserve the same fix.

**`CATCHUP_MAX_SIM_YEARS` and `OFFLINE_CAP_HOURS` weren't touched, and needed no change.** Offline
catch-up already goes through `advance`, and settlements have ticked inside `advance` since Batch 18.
So offline progression needed no new code; this batch only had to *prove* it. The proof has an
injection that routes catch-up around the settlements, and the exactness test caught it.

**One weakness in the tests' shape.** The seven hostile cases are a single `it`, so the first
failure hides the rest. Each case was injected on its own below, so each was seen to fail. But a
future regression that breaks two at once will report only one.

## Measurements

The test city (spaceport, two geothermal plants, a dome, a greenhouse, an extractor, a processor and
a depot):

| Years | Population | Water / O₂ / food | Save size |
|---|---|---|---|
| 8 | 7.886 | 54 | 1,314 B |
| 12 | 10.703 | 66 | 1,315 B |
| 40 | 34.321 | 100 (the cap) | 1,316 B |

- **Save cost:** one settlement adds about 700 bytes. A serialize plus deserialize round trip takes
  0.09 ms.
- **Offline grant, measured:**
  - 2 h away → 32.4 sim-years (129.6 substeps);
  - 8 h away → 129.6 sim-years;
  - 48 h away → 129.6 sim-years, the same as 8 h: the design cap holds.
- **The exactness test proves something:** over a 2-hour absence the city grows from 7.89 to 34.56
  people. Its vacuity guard requires more than 40 substeps and at least one new person.
- **Retune scenario:** the 40-year save is loaded under `DOME_HOUSING` 10, `MICRO_CAP_WATER` 5, no
  depot water and an 8-tile grid. It loads with population 10 and water 5, and all 8 buildings are
  kept, including the ones now off the grid.

## Verified by injection

| Broken on purpose | Caught by |
|---|---|
| `toSave` drops buildings | round trip, carry-on, retune, offline |
| Load ignores saved stores | round trip, carry-on, retune, offline |
| Load resets population | round trip, carry-on, retune, offline |
| Save also writes `capacities` | the key-set test |
| v4 migration founds with empty stores | the v4 test |
| Unknown type accepted | hostile |
| Fractional tile accepted | hostile |
| Level 0 accepted | hostile |
| Overlap accepted | hostile |
| Negative store accepted | hostile |
| Over-capacity store rejected (instead of clamped) | retune |
| Over-housing population kept | retune |
| Off-grid building dropped | retune, and the round trip |
| Forbidden-kind building dropped | the forbidden-kind test |
| Offline cap ignored | the design-cap test |
| Catch-up skips settlements | offline exactness |

## Open

- **Building `level` is saved, but nothing reads it.** No batch has specified upgrades. Levels are
  validated (a whole number, at least 1), so a future upgrade system inherits clean data.
- **`describe()` hides bad values** in other save messages (see above).
- **The browser still keeps settlements off.** That's Batch 20's switch.
- **Each settlement adds about 700 bytes to a save**, which is fine at any plausible count; there is
  no cap on settlement count yet.
