import type { MeshSurface, Vec3 } from '../../types';

/**
 * 삼각형 BVH (AABB 트리, 중앙값 분할, 잎 4개 이하). 물리 문서 6장.
 * 삼각형은 양면 처리이며 교차 계산은 float64로 한다. React·three.js 비의존.
 */
export interface Bvh {
  triCount: number;
  tris: Float64Array; // BVH 순서의 삼각형당 9개: v0(3), e1(3), e2(3)
  triIds: Uint32Array; // BVH 순서 → 전체 삼각형 번호 (메시 순서대로 이어 붙인 번호)
  nodeBounds: Float64Array; // 노드당 6개: min xyz, max xyz
  nodeLeft: Int32Array; // 왼쪽 자식, 잎이면 -1
  nodeRight: Int32Array; // 오른쪽 자식
  nodeStart: Int32Array; // 잎의 첫 삼각형 (BVH 순서)
  nodeCount: Int32Array; // 잎의 삼각형 수
  nodeTotal: number; // 사용된 노드 수
  bounds: { min: Vec3; max: Vec3 } | null; // 전체 바운딩 박스, 삼각형이 없으면 null
}

export interface Hit {
  t: number; // 레이 파라미터 (방향이 단위 벡터이면 거리 [m])
  triIndex: number; // 전체 삼각형 번호
}

const LEAF_SIZE = 4;
const PARALLEL_EPS = 1e-14; // 레이와 삼각형이 평행하다고 보는 한계

/** 메시들로 BVH를 만든다. 좌표는 m 단위여야 한다. */
export function buildBvh(meshes: readonly MeshSurface[]): Bvh {
  let n = 0;
  for (const m of meshes) n += m.indices.length / 3;

  const v = new Float64Array(n * 9); // 원래 순서의 v0,v1,v2
  const cen = new Float64Array(n * 3);
  const lo = new Float64Array(n * 3);
  const hi = new Float64Array(n * 3);
  let t = 0;
  for (const m of meshes) {
    const p = m.positions;
    for (let i = 0; i < m.indices.length; i += 3, t++) {
      for (let k = 0; k < 3; k++) {
        const vi = m.indices[i + k]! * 3;
        for (let c = 0; c < 3; c++) v[t * 9 + k * 3 + c] = p[vi + c]!;
      }
      for (let c = 0; c < 3; c++) {
        const a = v[t * 9 + c]!;
        const b = v[t * 9 + 3 + c]!;
        const d = v[t * 9 + 6 + c]!;
        lo[t * 3 + c] = Math.min(a, b, d);
        hi[t * 3 + c] = Math.max(a, b, d);
        cen[t * 3 + c] = (a + b + d) / 3;
      }
    }
  }

  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const maxNodes = Math.max(1, 2 * n);
  const nodeBounds = new Float64Array(maxNodes * 6);
  const nodeLeft = new Int32Array(maxNodes).fill(-1);
  const nodeRight = new Int32Array(maxNodes).fill(-1);
  const nodeStart = new Int32Array(maxNodes);
  const nodeCount = new Int32Array(maxNodes);
  let nodeTotal = 0;

  /** order[left..right] 안에서 k번째 원소를 축 기준으로 제자리 선택 (Hoare quickselect). */
  const select = (left: number, right: number, k: number, axis: number) => {
    while (left < right) {
      const pivot = cen[order[(left + right) >> 1]! * 3 + axis]!;
      let i = left;
      let j = right;
      while (i <= j) {
        while (cen[order[i]! * 3 + axis]! < pivot) i++;
        while (cen[order[j]! * 3 + axis]! > pivot) j--;
        if (i <= j) {
          const tmp = order[i]!;
          order[i] = order[j]!;
          order[j] = tmp;
          i++;
          j--;
        }
      }
      if (k <= j) right = j;
      else if (k >= i) left = i;
      else return;
    }
  };

  const build = (start: number, end: number): number => {
    const idx = nodeTotal++;
    let mnx = Infinity,
      mny = Infinity,
      mnz = Infinity;
    let mxx = -Infinity,
      mxy = -Infinity,
      mxz = -Infinity;
    let cmx = Infinity,
      cmy = Infinity,
      cmz = Infinity;
    let cMx = -Infinity,
      cMy = -Infinity,
      cMz = -Infinity;
    for (let i = start; i < end; i++) {
      const tri = order[i]! * 3;
      mnx = Math.min(mnx, lo[tri]!);
      mny = Math.min(mny, lo[tri + 1]!);
      mnz = Math.min(mnz, lo[tri + 2]!);
      mxx = Math.max(mxx, hi[tri]!);
      mxy = Math.max(mxy, hi[tri + 1]!);
      mxz = Math.max(mxz, hi[tri + 2]!);
      cmx = Math.min(cmx, cen[tri]!);
      cmy = Math.min(cmy, cen[tri + 1]!);
      cmz = Math.min(cmz, cen[tri + 2]!);
      cMx = Math.max(cMx, cen[tri]!);
      cMy = Math.max(cMy, cen[tri + 1]!);
      cMz = Math.max(cMz, cen[tri + 2]!);
    }
    nodeBounds.set([mnx, mny, mnz, mxx, mxy, mxz], idx * 6);
    if (end - start <= LEAF_SIZE) {
      nodeStart[idx] = start;
      nodeCount[idx] = end - start;
      return idx;
    }
    const ex = cMx - cmx,
      ey = cMy - cmy,
      ez = cMz - cmz;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2; // 가장 긴 축
    const mid = (start + end) >> 1;
    select(start, end - 1, mid, axis);
    nodeLeft[idx] = build(start, mid);
    nodeRight[idx] = build(mid, end);
    return idx;
  };
  if (n > 0) build(0, n);

  const tris = new Float64Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = order[i]! * 9;
    for (let c = 0; c < 3; c++) {
      const v0 = v[o + c]!;
      tris[i * 9 + c] = v0;
      tris[i * 9 + 3 + c] = v[o + 3 + c]! - v0;
      tris[i * 9 + 6 + c] = v[o + 6 + c]! - v0;
    }
  }

  const bounds =
    n > 0
      ? {
          min: [nodeBounds[0]!, nodeBounds[1]!, nodeBounds[2]!] as Vec3,
          max: [nodeBounds[3]!, nodeBounds[4]!, nodeBounds[5]!] as Vec3,
        }
      : null;

  return {
    triCount: n,
    tris,
    triIds: order,
    nodeBounds: nodeBounds.slice(0, nodeTotal * 6),
    nodeLeft: nodeLeft.slice(0, nodeTotal),
    nodeRight: nodeRight.slice(0, nodeTotal),
    nodeStart: nodeStart.slice(0, nodeTotal),
    nodeCount: nodeCount.slice(0, nodeTotal),
    nodeTotal,
    bounds,
  };
}

/** 장면 크기에 비례하는 자기 교차 방지 오프셋 ε = 1e-6 × 대각선 (물리 문서 6.2). */
export function bvhEpsilon(bvh: Bvh): number {
  if (!bvh.bounds) return 1e-6;
  const { min, max } = bvh.bounds;
  return 1e-6 * Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]), 1);
}

/** Möller–Trumbore. 교차하면 t, 아니면 Infinity. 양면, 경계 포함. */
function triangleT(
  tris: Float64Array, // BVH 삼각형 배열
  b: number, // 삼각형 시작 위치 (i*9)
  ox: number,
  oy: number,
  oz: number, // 레이 원점
  dx: number,
  dy: number,
  dz: number, // 레이 방향
): number {
  const e1x = tris[b + 3]!,
    e1y = tris[b + 4]!,
    e1z = tris[b + 5]!;
  const e2x = tris[b + 6]!,
    e2y = tris[b + 7]!,
    e2z = tris[b + 8]!;
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (a > -PARALLEL_EPS && a < PARALLEL_EPS) return Infinity;
  const f = 1 / a;
  const sx = ox - tris[b]!,
    sy = oy - tris[b + 1]!,
    sz = oz - tris[b + 2]!;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return Infinity;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const w = f * (dx * qx + dy * qy + dz * qz);
  if (w < 0 || u + w > 1) return Infinity;
  return f * (e2x * qx + e2y * qy + e2z * qz);
}

const stack = new Int32Array(128); // 순회 스택 (동기 호출 전용)

/** 노드 AABB와 레이의 교차 구간이 [tMin, tMax]와 겹치는지 (slab 방법). */
function hitsBox(
  nb: Float64Array, // 노드 경계 배열
  node: number, // 노드 번호
  ox: number,
  oy: number,
  oz: number, // 레이 원점
  ix: number,
  iy: number,
  iz: number, // 방향 역수
  tMin: number,
  tMax: number, // 유효 구간
): boolean {
  const o = node * 6;
  let t0 = tMin;
  let t1 = tMax;
  let a = (nb[o]! - ox) * ix;
  let b = (nb[o + 3]! - ox) * ix;
  if (a > b) {
    const s = a;
    a = b;
    b = s;
  }
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  a = (nb[o + 1]! - oy) * iy;
  b = (nb[o + 4]! - oy) * iy;
  if (a > b) {
    const s = a;
    a = b;
    b = s;
  }
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  a = (nb[o + 2]! - oz) * iz;
  b = (nb[o + 5]! - oz) * iz;
  if (a > b) {
    const s = a;
    a = b;
    b = s;
  }
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  return t0 <= t1;
}

/** 구간 (tMin, tMax) 안에서 가장 가까운 교차. 없으면 null. */
export function closestHit(
  bvh: Bvh,
  o: Vec3, // 원점
  d: Vec3, // 방향 (단위 벡터 권장)
  tMin: number,
  tMax: number,
): Hit | null {
  if (bvh.nodeTotal === 0) return null;
  const [ox, oy, oz] = o;
  const [dx, dy, dz] = d;
  const ix = 1 / dx,
    iy = 1 / dy,
    iz = 1 / dz;
  let best = tMax;
  let bestTri = -1;
  let sp = 0;
  stack[sp++] = 0;
  while (sp > 0) {
    const node = stack[--sp]!;
    if (!hitsBox(bvh.nodeBounds, node, ox, oy, oz, ix, iy, iz, tMin, best)) continue;
    const left = bvh.nodeLeft[node]!;
    if (left < 0) {
      const s = bvh.nodeStart[node]!;
      const e = s + bvh.nodeCount[node]!;
      for (let i = s; i < e; i++) {
        const t = triangleT(bvh.tris, i * 9, ox, oy, oz, dx, dy, dz);
        if (t > tMin && t < best) {
          best = t;
          bestTri = i;
        }
      }
    } else {
      stack[sp++] = bvh.nodeRight[node]!;
      stack[sp++] = left;
    }
  }
  return bestTri < 0 ? null : { t: best, triIndex: bvh.triIds[bestTri]! };
}

/** 구간 (tMin, tMax) 안에 교차가 하나라도 있는지 (가시선 판정용, 즉시 종료). */
export function anyHit(bvh: Bvh, o: Vec3, d: Vec3, tMin: number, tMax: number): boolean {
  if (bvh.nodeTotal === 0) return false;
  const [ox, oy, oz] = o;
  const [dx, dy, dz] = d;
  const ix = 1 / dx,
    iy = 1 / dy,
    iz = 1 / dz;
  let sp = 0;
  stack[sp++] = 0;
  while (sp > 0) {
    const node = stack[--sp]!;
    if (!hitsBox(bvh.nodeBounds, node, ox, oy, oz, ix, iy, iz, tMin, tMax)) continue;
    const left = bvh.nodeLeft[node]!;
    if (left < 0) {
      const s = bvh.nodeStart[node]!;
      const e = s + bvh.nodeCount[node]!;
      for (let i = s; i < e; i++) {
        const t = triangleT(bvh.tris, i * 9, ox, oy, oz, dx, dy, dz);
        if (t > tMin && t < tMax) return true;
      }
    } else {
      stack[sp++] = bvh.nodeRight[node]!;
      stack[sp++] = left;
    }
  }
  return false;
}

/** 점 a에서 점 b가 가려지지 않고 보이는지. 양 끝 ε 구간은 제외한다. */
export function segmentVisible(bvh: Bvh | null, a: Vec3, b: Vec3, eps: number): boolean {
  if (!bvh) return true;
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dz = b[2] - a[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= 2 * eps) return true;
  return !anyHit(bvh, a, [dx / dist, dy / dist, dz / dist], eps, dist - eps);
}

/** 검증용 완전 탐색 (BVH 없이 모든 삼각형 검사). 테스트에서 BVH 결과와 비교한다. */
export function bruteForceClosest(
  bvh: Bvh,
  o: Vec3,
  d: Vec3,
  tMin: number,
  tMax: number,
): Hit | null {
  let best = tMax;
  let bestTri = -1;
  for (let i = 0; i < bvh.triCount; i++) {
    const t = triangleT(bvh.tris, i * 9, o[0], o[1], o[2], d[0], d[1], d[2]);
    if (t > tMin && t < best) {
      best = t;
      bestTri = i;
    }
  }
  return bestTri < 0 ? null : { t: best, triIndex: bvh.triIds[bestTri]! };
}

/** 단일 삼각형 교차 (테스트용 공개). 교차하지 않으면 Infinity. */
export function intersectTriangle(v0: Vec3, v1: Vec3, v2: Vec3, o: Vec3, d: Vec3): number {
  const tri = new Float64Array([
    v0[0],
    v0[1],
    v0[2],
    v1[0] - v0[0],
    v1[1] - v0[1],
    v1[2] - v0[2],
    v2[0] - v0[0],
    v2[1] - v0[1],
    v2[2] - v0[2],
  ]);
  return triangleT(tri, 0, o[0], o[1], o[2], d[0], d[1], d[2]);
}
