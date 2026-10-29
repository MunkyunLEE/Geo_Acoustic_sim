import type { MeshSurface, Vec3 } from '../types';

/** 꼭짓점 용접 정보: 같은 위치의 꼭짓점들을 한 그룹으로 묶는다 (STL은 삼각형마다 꼭짓점이 따로 있음). */
export interface Weld {
  groups: number[][]; // 그룹별 꼭짓점 인덱스 목록
  groupOf: Int32Array; // 꼭짓점 인덱스 → 그룹 번호
}

const cache = new WeakMap<MeshSurface, Weld>();

/** 메시의 용접 그룹 (메시 객체별로 캐시). 같은 위치 = 1e-5 m 안. */
export function getWeld(m: MeshSurface): Weld {
  const hit = cache.get(m);
  if (hit) return hit;
  const p = m.positions;
  const n = p.length / 3;
  const key = new Map<string, number>();
  const groups: number[][] = [];
  const groupOf = new Int32Array(n);
  const q = 1e5; // 양자화 (1e-5 m)
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(p[i * 3]! * q)},${Math.round(p[i * 3 + 1]! * q)},${Math.round(p[i * 3 + 2]! * q)}`;
    let g = key.get(k);
    if (g === undefined) {
      g = groups.length;
      key.set(k, g);
      groups.push([]);
    }
    groups[g]!.push(i);
    groupOf[i] = g;
  }
  const w = { groups, groupOf };
  cache.set(m, w);
  return w;
}

/** 그룹의 위치 (그룹 첫 꼭짓점, 국소 좌표). */
export function groupPos(m: MeshSurface, w: Weld, g: number): Vec3 {
  const i = w.groups[g]![0]! * 3;
  return [m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!];
}

/** 선택한 그룹들의 중심 (국소 좌표). 비어 있으면 null. */
export function groupsCentroid(m: MeshSurface, w: Weld, groups: readonly number[]): Vec3 | null {
  if (groups.length === 0) return null;
  const c: [number, number, number] = [0, 0, 0];
  for (const g of groups) {
    const p = groupPos(m, w, g);
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return [c[0] / groups.length, c[1] / groups.length, c[2] / groups.length];
}

/** 선택한 그룹들을 국소 좌표 delta만큼 옮긴 새 메시 (원본은 그대로). */
export function moveGroups(
  m: MeshSurface,
  w: Weld,
  groups: readonly number[],
  delta: Vec3,
): MeshSurface {
  const pos = m.positions.slice();
  for (const g of groups) {
    for (const i of w.groups[g]!) {
      pos[i * 3] = pos[i * 3]! + delta[0];
      pos[i * 3 + 1] = pos[i * 3 + 1]! + delta[1];
      pos[i * 3 + 2] = pos[i * 3 + 2]! + delta[2];
    }
  }
  const out = { ...m, positions: pos };
  cache.set(out, w); // 꼭짓점 번호를 유지 (이동으로 겹쳐져도 그룹이 합쳐지지 않게)
  return out;
}

const triGroups = (m: MeshSurface, w: Weld, t: number): [number, number, number] => [
  w.groupOf[m.indices[t * 3]!]!,
  w.groupOf[m.indices[t * 3 + 1]!]!,
  w.groupOf[m.indices[t * 3 + 2]!]!,
];

function triNormal(m: MeshSurface, t: number): Vec3 {
  const p = m.positions;
  const [a, b, c] = [m.indices[t * 3]! * 3, m.indices[t * 3 + 1]! * 3, m.indices[t * 3 + 2]! * 3];
  const e1: Vec3 = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
  const e2: Vec3 = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
  const n: Vec3 = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const l = Math.hypot(n[0], n[1], n[2]);
  return l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 1];
}

/** 삼각형 t와 같은 평면이면서 모서리로 이어진 삼각형들 (사각형 면 = 삼각형 2개). */
export function faceTriangles(m: MeshSurface, w: Weld, t: number): number[] {
  const nTri = m.indices.length / 3;
  const edgeTris = new Map<string, number[]>();
  const ekey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let i = 0; i < nTri; i++) {
    const [a, b, c] = triGroups(m, w, i);
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = ekey(x, y);
      const l = edgeTris.get(k);
      if (l) l.push(i);
      else edgeTris.set(k, [i]);
    }
  }
  const n0 = triNormal(m, t);
  const seen = new Set<number>([t]);
  const queue = [t];
  while (queue.length) {
    const cur = queue.pop()!;
    const [a, b, c] = triGroups(m, w, cur);
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      for (const nb of edgeTris.get(ekey(x, y)) ?? []) {
        if (seen.has(nb)) continue;
        const nn = triNormal(m, nb);
        if (Math.abs(n0[0] * nn[0] + n0[1] * nn[1] + n0[2] * nn[2]) >= 0.9999) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
  }
  return [...seen];
}

/** 삼각형들에 쓰인 꼭짓점 그룹 (중복 없음). */
export function groupsOfTriangles(m: MeshSurface, w: Weld, tris: readonly number[]): number[] {
  const s = new Set<number>();
  for (const t of tris) for (const g of triGroups(m, w, t)) s.add(g);
  return [...s];
}

/** 삼각형 t의 세 모서리 중 국소 점 pt에 가장 가까운 모서리의 꼭짓점 그룹 두 개. */
export function nearestEdge(m: MeshSurface, w: Weld, t: number, pt: Vec3): [number, number] {
  const g = triGroups(m, w, t);
  let best: [number, number] = [g[0], g[1]];
  let bd = Infinity;
  for (const [a, b] of [
    [g[0], g[1]],
    [g[1], g[2]],
    [g[2], g[0]],
  ] as const) {
    const pa = groupPos(m, w, a);
    const pb = groupPos(m, w, b);
    const ab: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const ap: Vec3 = [pt[0] - pa[0], pt[1] - pa[1], pt[2] - pa[2]];
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const u =
      l2 > 0 ? Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
    const d = Math.hypot(ap[0] - u * ab[0], ap[1] - u * ab[1], ap[2] - u * ab[2]);
    if (d < bd) {
      bd = d;
      best = [a, b];
    }
  }
  return best;
}
