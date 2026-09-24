# Batch 18 — Micro: one settlement as pure TypeScript, plus the coupling

Micro doc §12 step 2: *"Implement one settlement as pure TypeScript: grid, the nine building
definitions, the tick (section 7), the two-way macro coupling (section 2). No rendering. Verify a city
survives, grows, and that an Atmosphere Processor's planetary output shows up in the macro sim's
rate."*

**What was built:**
- the ten buildings of §5, as data;
- placement rules (§3.3);
- the micro tick (§7): brownout, stress, and logistic population;
- the two-way coupling (§2), behind `SETTLEMENTS_ENABLED = 0`.

**Exit gate met, and checked by injection.** With settlements off, the golden run, golden frames,
Batch 3 score and determinism are unchanged. 663 tests pass, up from 650.

## Decisions taken (defaults, on a bare "go")

1. **The Atmosphere Processor is MOXIE-style CO₂ → O₂**, as the micro doc says, not the macro
   doc's regolith *venter* (which adds CO₂). The carbon leaves as carbon monoxide, booked to
   `c_sequestered`, so the carbon ledger closes. Oxygen appears at 32/88 of the CO₂ mass drawn
   (2 CO₂ → 2 CO + O₂), written from the molar masses in `tuning.ts`.
2. **Settlements coexist with the facility system**, behind `SETTLEMENTS_ENABLED`, default 0.
   Retiring facilities would rebalance the calibrated game; that belongs to its own batch.
3. **The planet is seen only through `HabitatChannels`**, which gained one reading, `insolation`,
   for the Solar Array.
4. **Materials are separate from credits.**
5. **Founding lands a starting stock**: 250 materials and 30 of each life-support resource.
6. **§5's ten buildings.** The GHG Factory building that §2.2 names isn't among them, so the
   Atmosphere Processor is the only building that pushes the planet.
7. **The Spaceport imports only**; its orbital projects wait for the migration.
8. **Saving the new fields is Batch 19's.** The browser leaves settlements off until there's UI
   to place buildings and a save to keep them.

## What went wrong

**The doc's two shortfall rules, read literally together, make a shortfall harmless.**
- §7.2 switches off every consumer of a short resource, the domes included.
- §7.3 counts a life-support need as unmet only when its store is **empty**.

But a browned-out dome stops drawing water, oxygen and food, so those stores never empty. I measured
it: a city with every power plant removed stayed "supported" for ever, with its population flat at
39.99. §7.2 says a life-support shortage *"harms population"*, so a shortage this substep now counts
as unsupported whatever the store holds. Measured after the fix: unsupported from year 1, and 40
people fall to 15.1 in five years, which is the 0.2/yr decline (e⁻¹ = 0.37).

**The spec left a gap the city can't grow through.** §7.3's growth is proportional to population, so
a city that starts with nobody stays empty for ever. `MICRO_SEED_POPULATION` (4) brings the first
settlers once a city has housing and every need met.

**On a bare Mars an Atmosphere Processor pulls nothing from the planet.** At 6.2 mbar the air is
below the pressure floor (`P_FLOOR`, 8 mbar), so the same guard that stops the scrubber holds the
processor back: it must not pull the planet under the triple point. This is correct, but it means a
first-hour city's processor feeds only its own oxygen. A test pins it, and the planetary tests use a
real mid-game world instead.

**Four of my own test fixtures were sloppy** and were rewritten before trusting them:
- the logistic check first measured the settlers' one-step arrival, not the curve;
- the solar test faked the insolation number instead of going through real orbital mirrors;
- an injection meant for chunk-independence ticked on a fixed global schedule, which chunking can't
  see. The per-call injection was added; that one the chunk test catches.

## Measurements

**The doc's bootstrap order (§2.3) on the founding stock**, building only when affordable:
- Spaceport, geothermal, solar, a dome and a greenhouse at year 0;
- then the extractor at year 7, the mine at 15, a second geothermal at 22, the processor at 29, a
  depot at 30, a second dome at 38, a greenhouse at 42, and another geothermal at 48;
- supported in every year, and 80.00 people at year 150 in two 40-person domes.

**Logistic shape**, one dome fully supplied: half housing reached at year 23, with the fastest growth
at the same place, as a logistic curve should have it.

**The coupling**, 4 processors on the reference world at year 600 (397 mbar, 273 mbar of CO₂):

| | Value |
|---|---|
| CO₂ draw in the macro flows | 0.2000 mbar/yr, exactly 4 × 0.05 |
| O₂ release | 0.07273 mbar/yr, exactly 32/88 of the draw |
| Over 100 years: CO₂ sequestered | 20.000 mbar |
| Over 100 years: CO₂ in the air | down 19.95 |
| Over 100 years: O₂ | up 7.25 |
| Carbon ledger drift over the century | 8.8e-12 mbar |

## Verified by injection

| Broken on purpose | Caught by |
|---|---|
| Stress read off the stores only (the literal reading) | the shortfall test |
| Settlement flows never reach the planet | the rate test and the chemistry test |
| O₂ released 1:1 by mass | the rate test and the chemistry test |
| Settlements tick once per four substeps | the growth and shortfall tests |
| Settlements tick once per `advance` call | the chunk-independence test |
| `SETTLEMENTS_ENABLED` ignored | the off-by-default test |
| The pressure floor removed | the bare-Mars test |
| No brownout | the shortfall test |
| Solar ignores sunlight | the real-mirrors test |

## Open

- **Saving stores, people and buildings** (Batch 19). Until then the browser keeps settlements off,
  and a v4 save loads a settlement as newly founded.
- **The GHG Factory building** (§2.2, §2.3) is missing from §5's set. Adding it is a doc decision.
- **Retiring the facility system** in favour of settlements (conflict 1): its own batch, and a
  rebalance.
- **Two buildings share a name and do opposite things:** "Atmospheric processor" (the macro
  facility, adds CO₂) and "Atmosphere Processor" (the building, removes it). Renaming one is the
  user's call.
- **Every building is "connected"** (§6's serviced area is a single yes). Relays and range come
  later.
- **Nobody has played this.** The numbers make the doc's bootstrap work end to end, but whether
  it's fun is for Batch 20's view to show.
