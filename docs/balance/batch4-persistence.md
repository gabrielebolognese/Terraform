# Batch 4 note — persistence and offline catch-up

Design doc §11 (save schema) and §8.2 (offline progression). What was built, and the one place §8.2
read literally would have given the game away.

---

## 1. The save

§11's shape, with the field names it specifies (`schema_version`, `planet_id`, `sim_year`,
`last_saved_real`, `shield_strength`, `tech_unlocked`). Two rules from its design notes drove
everything:

**Store only the state.** No `T`, no `P`, no `progress`, no visual channel — they are recomputed on
load, so a tuning change applies retroactively to old saves instead of baking in stale numbers. A
test asserts the written file contains none of them. The one apparent exception is `phase`, which
§11 does store; that is the *latched* high-water mark, which is state (a milestone, once reached,
stays reached) rather than the instantaneous evaluation.

**A save is untrusted input.** It has been through JSON, disk, possibly a hand edit and certainly an
older version of the code. Every field is validated with a message that names it — `reservoirs.o2 is
negative (-1)`, not `undefined is not a number` three ticks later.

One addition to §11: **`steps`**, the integer substep count, stored alongside the `sim_year` the doc
specifies. `sim_year` is written for legibility and ignored on load when `steps` is present, because
recovering the grid position from a rounded float would let it drift by a substep on every
save/load cycle. A test pins the property that matters: **a save in the middle of a run is invisible
to the result** — save, load, continue is bit-identical to running straight through.

## 2. The migration is real, not a placeholder

§11's shape genuinely predates four things that arrived in Batches 1 and 2: the nitrate reservoir
(§3.6 described a trickle with no source), the conservation ledger, the `seeded` flag, and the
facility deployment ramp. So v1 → v2 needed four decisions rather than four defaults:

| Field | Decision | Why |
|---|---|---|
| `n2_reg` | **0**, not the Mars default of 20 | a v1 world was played without one; handing it 20 mbar would materialise nitrogen that world never had |
| `ledger` | **zeroed** | the accounts cannot be reconstructed, and it is harmless: conservation is checked as *drift from the loaded baseline*, not against an absolute constant |
| `seeded` | **inferred from biomass** | §3.5 is the only way to get a biosphere, so having one means it was seeded |
| facility `deployed` | **`count × level`, fully online** | v1 predates the ramp, so its capacity was instantaneous; starting at 0 would silently switch off a loaded player's entire industry |

A migrated v1 save is then held to exactly the same validation as one written today, and re-saving it
round-trips.

## 3. §8.2 would have given the game away

> §8.2: "on load, compute `elapsed = now - last_saved`, convert to sim-years, and advance the sim by
> that much before showing the planet."

Free, and reproducible — but at `TIME_SCALE = 0.03` a 48-hour absence is worth **5184 sim-years**
against a full playthrough of **1710**. One weekend away finishes the game three times over, which
contradicts design goal #2 ("growth must be long, steady, and visible") outright. A test asserts that
arithmetic so the reason the cap exists cannot be forgotten.

There are now **two caps, and they are different things**:

- the **work cap** (`CATCHUP_MAX_SIM_YEARS`, already in `catchUp` since Batch 1) bounds how long the
  load screen takes. It is about milliseconds.
- the **design cap** (`OFFLINE_CAP_HOURS = 8`, `OFFLINE_RATE_FACTOR = 0.15`) bounds how much of the
  *game* an absence is worth. It is about whether there is still a game to come back to.

A 48-hour absence is worth `8 × 3600 × 0.03 × 0.15 = 129.6` sim-years — about 7.6% of a playthrough.
**Ten consecutive 48-hour absences come to 1295 sim-years, short of one arc**, which is the test the
plan asked for by name. Eight hours of *active* play over the same window is worth 864 sim-years, so
playing beats not playing by about 6.7×.

The grant lands on the integer substep grid, so a fraction of a substep is dropped per absence (129.6
becomes 518 steps, or 129.5). It always rounds down, never up.

**A backwards clock costs nothing rather than breaking the save.** Daylight saving, an NTP
correction, a user changing the system date — none of those should brick a world, so negative and
non-finite elapsed times clamp to zero. An unparseable `last_saved_real` resumes with no time passed.

## 4. Everything takes the time as a parameter

`src/sim/` still has no clock. `toSave` takes the timestamp, `resume` takes `nowEpochMs`, and
`offlineGrant` takes elapsed seconds. The only place a clock is *read* is `src/web/session.ts`, and
it reads through an injected `Clock`, which is what makes the exit gate's test possible at all —
"reopen it hours later" is not something CI can do.

`Date.parse` on the ISO timestamp is the one `Date` call inside `src/sim/`. It is a pure,
well-specified function of its input and reads no clock, so it does not weaken the determinism the
rest of the file exists to protect. The boundary test still bans `Date.now`, `new Date` and
`Math.random` there.

## 5. Storage

`SaveStore` is a three-method interface the simulation defines and hosts implement: IndexedDB in the
browser, in-memory in tests, a row on a server later — §11 notes the shape is the same either way.

**Opening it never rejects.** IndexedDB is genuinely unavailable in ordinary situations — a private
window, blocked site data, some embedded webviews — and in those the game falls back to an in-memory
store whose `durable` flag is `false`, so the UI says *"this browser has no durable storage
available, so progress will not survive a reload"* rather than throwing on the first autosave or
silently discarding the player's afternoon.

Writes are **serialised through a single in-flight promise**. Autosave, a visibility change and a
page-hide can all fire within a frame of each other, and overlapping IndexedDB writes to one slot
race for which lands last — the loser being whichever the browser finishes second, not whichever is
newer. A failed write never takes down the render loop; it increments a counter the UI reads.

The world is written every 15 s, on tab-hide, and on `pagehide` — the last of which fires on close and
on bfcache eviction, where `beforeunload` does not.

## 6. A broken save does not break the game

Corrupt save, save from a newer build, storage that throws on read: each starts a fresh world and
**says what happened**, rather than either throwing or silently resetting. Losing a save is bad;
refusing to start because of one is worse, and quietly resetting without saying so is worst.

## 7. For later batches

- **Multiple slots and multiple planets.** `SaveStore` is keyed by slot and the save carries
  `planet_id`, so the mechanism is there; nothing uses more than one yet.
- **`economy` is still `unknown`.** It round-trips untouched, which is all Batch 9 needs from it.
- **The away summary is one line.** Batch 7 (game shell) is where it becomes a proper panel — the
  deltas it needs (`T`, `P`, `o2`, biomass, ocean, progress, phases gained) are already computed.
- **Offline rate is a design knob, not a physics one.** `OFFLINE_RATE_FACTOR = 0.15` is deliberately
  unkind by idle-game standards; if playtesting says it is too punitive, it is one number.
