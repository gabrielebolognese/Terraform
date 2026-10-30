/**
 * Make a real old save (Batch 40), with an era's own code - for `src/web/old-saves.test.ts`.
 *
 * Take the era's source from the commit before its schema moved on, into a directory of its own
 * outside the repository, with a package.json of `{ "type": "module" }` above it:
 *
 *   git archive <commit> src | tar -x -C <dir>/eras/v20
 *   npx tsx scripts/old-save.ts <dir>/eras/v20 src/web/old-saves/v20.json 20 <commit> 2026-10-30T12:00:00Z
 *
 * It makes a Standard world through that era's WorldLibrary and MemorySaveStore, founds a city and an
 * outpost, builds, connects, upgrades and queues, plays on, saves as the app saves, and writes the
 * worlds list, the save and the export file exactly as that browser kept them. The commits for v13 to
 * v20 are in the test's files (`commit`).
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [eraDir, out, version, commit, dateIso] = process.argv.slice(2) as [string, string, string, string, string];
const imp = (p: string) => import(pathToFileURL(`${eraDir}/src/${p}`).href);
const sim = await imp("sim/index.ts");
const worlds = await imp("web/worlds.ts");
const storage = await imp("web/storage.ts");

let clock = Date.parse(dateIso);
const store = new storage.MemorySaveStore(true);
const lib = new worlds.WorldLibrary(store, () => clock);
await lib.open();
const meta = await lib.create({ name: `Old world v${version}`, seed: 4242, mode: "standard", pace: "standard" });
const loaded = await lib.load(meta.id);
if (!loaded.ok) throw new Error("load: " + loaded.reason);
let state = loaded.state;
const t = loaded.tuning;
const cfg = { tuning: t, env: sim.NEUTRAL_ENV, forcing: null };
const log: string[] = [];

function found(kind: string, lat: number, lon: number, name: string): string | null {
  const r = sim.foundSettlement(state, kind, lat, lon, t, name);
  log.push(`found ${kind} ${name}: ${r.ok ? r.settlement.id : r.reason}`);
  if (!r.ok) return null;
  state = r.state;
  return r.settlement.id as string;
}
const city = found("city", 0.31, -1.2, "Firstlight");
const outpost = found("outpost", 0.33, -1.17, "Ridge");
if (city === null) throw new Error("no city");

function place(id: string, type: string): boolean {
  const s = state.settlements.find((x: { id: string }) => x.id === id);
  const n = Math.round(s.kind === "outpost" ? t.OUTPOST_GRID_TILES : t.CITY_GRID_TILES);
  const c = Math.floor(n / 2);
  let why = "";
  for (let r = 3; r < c - 4; r += 1) {
    for (let k = 0; k < 8 * r; k += 1) {
      const a = (k / (8 * r)) * 2 * Math.PI;
      const tx = c + Math.round(r * Math.cos(a));
      const ty = c + Math.round(r * Math.sin(a));
      const o = sim.placeBuilding(state, id, type, tx, ty, t);
      if (!o.ok) why = o.reason;
      if (o.ok) {
        state = o.state;
        log.push(`place ${type} at ${tx},${ty} in ${id}`);
        return true;
      }
    }
  }
  log.push(`place ${type} in ${id}: refused everywhere (${why})`);
  return false;
}

const plan = ["solar_array", "habitat_dome", "water_extractor", "greenhouse", "regolith_mine"];
for (let i = 0; i < plan.length; i += 1) {
  place(city, plan[i]!);
  if (i === 2 && outpost !== null) place(outpost, "solar_array");
  state = sim.advance(state, 12, cfg);
  clock += 12 * 8300;
}
if (typeof sim.connectAll === "function") {
  const r = sim.connectAll(state, city, t);
  if (r.ok) state = r.state;
  log.push(`connectAll: ${r.ok ? r.laid : r.reason}`);
}
// An upgrade under way, if there is a building to upgrade.
const s0 = state.settlements.find((x: { id: string }) => x.id === city);
const solar = s0.buildings.find((b: { type: string }) => b.type === "solar_array");
if (solar !== undefined && typeof sim.upgradeBuilding === "function") {
  const r = sim.upgradeBuilding(state, city, solar.tx, solar.ty, t);
  if (r.ok) state = r.state;
  log.push(`upgrade solar: ${r.ok ? "ok" : r.reason}`);
}
// And more builds than rovers, so something waits in the queue (v14 on).
for (const type of ["solar_array", "solar_array", "solar_array", "solar_array"]) place(city, type);
state = sim.advance(state, 3, cfg);
clock += 3 * 8300;

await store.save(meta.slot, sim.toSave(state, t, new Date(clock).toISOString()));
await lib.record(meta.id, state, { playtimeMs: clock - Date.parse(dateIso) });
const index = await store.loadMeta("worlds");
const save = store.raw(meta.slot) as string;
const exported = await lib.exportWorld(meta.id);
const s1 = state.settlements.find((x: { id: string }) => x.id === city);
const made = {
  steps: state.steps,
  settlements: state.settlements.length,
  buildings: s1.buildings.length,
  jobs: s1.jobs.length,
  queued: (s1.buildQueue ?? []).length,
  population: s1.population,
  log,
};
writeFileSync(out, JSON.stringify({ schema: Number(version), commit, made, slot: meta.slot, index, save, exported }));
console.log(JSON.stringify({ version, bytes: save.length, ...made, log: undefined }));
console.log(log.join("\n"));
