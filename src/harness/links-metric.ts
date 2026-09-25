/**
 * How many of a settlement's corridor tiles are its only link somewhere: the
 * tiles whose loss would cut part of the city off (articulation points of
 * the graph of corridor tiles and buildings, found by Tarjan's method,
 * iteratively). For the example's tests.
 */

import type { Settlement } from "../sim/index.js";
import { BUILDING_DEFS } from "../sim/index.js";

export function soleLinks(s: Settlement, n: number): { links: number; sole: number } {
  const owner = new Int32Array(n * n).fill(-1);
  s.buildings.forEach((b, i) => {
    const d = BUILDING_DEFS[b.type];
    for (let y = b.ty; y < b.ty + d.depth; y += 1) for (let x = b.tx; x < b.tx + d.footprint; x += 1) if (x >= 0 && y >= 0 && x < n && y < n) owner[y * n + x] = i;
  });
  const road = new Uint8Array(n * n);
  for (const k of s.corridors) {
    const x = k % 1024;
    const y = Math.floor(k / 1024);
    if (x < n && y < n && owner[y * n + x]! < 0) road[y * n + x] = 1;
  }
  // Nodes: buildings 0..B-1, then road tiles.
  const B = s.buildings.length;
  const id = new Int32Array(n * n).fill(-1);
  let count = B;
  for (let i = 0; i < n * n; i += 1) if (road[i]) id[i] = count++;
  const nodeOf = (i: number): number => (owner[i]! >= 0 ? owner[i]! : id[i]!);
  const adj: number[][] = Array.from({ length: count }, () => []);
  const edges = new Set<string>();
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const a = nodeOf(y * n + x);
      if (a < 0) continue;
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]] as const) {
        if (nx >= n || ny >= n) continue;
        const b = nodeOf(ny * n + nx);
        if (b < 0 || b === a) continue;
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (edges.has(key)) continue;
        edges.add(key);
        adj[a]!.push(b);
        adj[b]!.push(a);
      }
    }
  }
  const disc = new Int32Array(count).fill(-1);
  const low = new Int32Array(count);
  const art = new Uint8Array(count);
  let time = 0;
  for (let root = 0; root < count; root += 1) {
    if (disc[root] !== -1) continue;
    const stack: [number, number, number][] = [[root, -1, 0]];
    disc[root] = low[root] = time++;
    let rootChildren = 0;
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const [v, parent, k] = top;
      if (k < adj[v]!.length) {
        top[2] = k + 1;
        const w = adj[v]![k]!;
        if (w === parent) continue;
        if (disc[w] === -1) {
          disc[w] = low[w] = time++;
          if (v === root) rootChildren += 1;
          stack.push([w, v, 0]);
        } else low[v] = Math.min(low[v]!, disc[w]!);
      } else {
        stack.pop();
        if (parent >= 0) {
          low[parent] = Math.min(low[parent]!, low[v]!);
          if (parent !== root && low[v]! >= disc[parent]!) art[parent] = 1;
        }
      }
    }
    if (rootChildren > 1) art[root] = 1;
  }
  let sole = 0;
  for (let v = B; v < count; v += 1) sole += art[v]!;
  return { links: count - B, sole };
}
