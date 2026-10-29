import type { MeshSurface, Vec3 } from '../types';

export type Pt2 = [number, number];

/** 다각형 면적의 두 배 (부호 있음, 반시계가 양수). */
export function signedArea2(p: readonly Pt2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % p.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

/** 귀 자르기(ear clipping)로 단순 다각형을 삼각형 분할한다. 꼭짓점 인덱스를 반환하며 방향은 반시계. */
export function triangulate(p: readonly Pt2[]): number[] {
  const n = p.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  if (signedArea2(p) < 0) idx.reverse();
  const cross = (a: Pt2, b: Pt2, c: Pt2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (pt: Pt2, a: Pt2, b: Pt2, c: Pt2) =>
    cross(a, b, pt) >= 0 && cross(b, c, pt) >= 0 && cross(c, a, pt) >= 0;
  const out: number[] = [];
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length]!;
      const ib = idx[k]!;
      const ic = idx[(k + 1) % idx.length]!;
      const [a, b, c] = [p[ia]!, p[ib]!, p[ic]!];
      if (cross(a, b, c) <= 1e-12) continue; // 오목 꼭짓점은 귀가 아님
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(p[j]!, a, b, c))) continue;
      out.push(ia, ib, ic);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // 자기 교차 등으로 더 못 자르면 중단
  }
  if (idx.length === 3) out.push(idx[0]!, idx[1]!, idx[2]!);
  return out;
}

const mesh = (name: string, pos: number[], idx: number[]): MeshSurface => ({
  id: name,
  name,
  positions: Float32Array.from(pos),
  indices: Uint32Array.from(idx),
  materialId: '',
});

/** 국소 단위 박스 (한 변 1, 원점 중심, 12 삼각형). 크기는 변환의 scale로 준다. */
export function unitBox(): MeshSurface {
  const h = 0.5;
  // prettier-ignore
  const pos = [-h,-h,-h, h,-h,-h, h,h,-h, -h,h,-h, -h,-h,h, h,-h,h, h,h,h, -h,h,h];
  // prettier-ignore
  const idx = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 2,3,7, 2,7,6, 0,4,7, 0,7,3, 1,2,6, 1,6,5];
  return mesh('박스', pos, idx);
}

/** 국소 단위 평면 (XY, 한 변 1, 원점 중심, 열린 서페이스). */
export function unitPlane(): MeshSurface {
  const h = 0.5;
  return mesh('평면', [-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0], [0, 1, 2, 0, 2, 3]);
}

/** 국소 단위 원기둥 (지름 1, 높이 1, 원점 중심). capped=false면 옆면만 (열린 서페이스). */
export function unitCylinder(segments = 24, capped = true): MeshSurface {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pos.push(0.5 * Math.cos(t), 0.5 * Math.sin(t), -0.5, 0.5 * Math.cos(t), 0.5 * Math.sin(t), 0.5);
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    idx.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1);
  }
  if (capped) {
    const cb = pos.length / 3;
    pos.push(0, 0, -0.5, 0, 0, 0.5);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      idx.push(cb, j * 2, i * 2, cb + 1, i * 2 + 1, j * 2 + 1);
    }
  }
  return mesh('원기둥', pos, idx);
}

export interface ExtrudeOptions {
  closed: boolean; // 닫힌 폴리라인이면 마지막 점과 첫 점을 잇는다
  capBottom: boolean; // 아래 뚜껑 (닫힌 폴리라인만)
  capTop: boolean; // 위 뚜껑 (닫힌 폴리라인만)
}

/**
 * 평면 폴리라인을 z0에서 z0+height까지 extrude한 서페이스. 좌표는 세계 좌표이며,
 * 열린 폴리라인은 벽(옆면만), 닫힌 폴리라인은 벽 + 선택적 뚜껑이다.
 */
export function extrudePolyline(
  points: readonly Pt2[],
  z0: number,
  height: number,
  o: ExtrudeOptions,
): MeshSurface {
  const n = points.length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [x, y] of points) pos.push(x, y, z0, x, y, z0 + height); // 2i: 아래, 2i+1: 위
  const edges = o.closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % n;
    idx.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1);
  }
  if (o.closed && (o.capBottom || o.capTop)) {
    const tri = triangulate(points);
    for (let k = 0; k < tri.length; k += 3) {
      const [a, b, c] = [tri[k]!, tri[k + 1]!, tri[k + 2]!];
      if (o.capBottom) idx.push(a * 2, c * 2, b * 2);
      if (o.capTop) idx.push(a * 2 + 1, b * 2 + 1, c * 2 + 1);
    }
  }
  return mesh('extrude', pos, idx);
}

/** 닫힌 폴리라인 한 장 면 (높이 z). */
export function polygonFace(points: readonly Pt2[], z: number): MeshSurface {
  const pos: number[] = [];
  for (const [x, y] of points) pos.push(x, y, z);
  return mesh('면', pos, triangulate(points));
}

/** 메시 총 면적 [m²]. */
export function meshArea(m: MeshSurface): number {
  const p = m.positions;
  let a = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [i, j, k] = [m.indices[t]! * 3, m.indices[t + 1]! * 3, m.indices[t + 2]! * 3];
    const e1: Vec3 = [p[j]! - p[i]!, p[j + 1]! - p[i + 1]!, p[j + 2]! - p[i + 2]!];
    const e2: Vec3 = [p[k]! - p[i]!, p[k + 1]! - p[i + 1]!, p[k + 2]! - p[i + 2]!];
    a +=
      0.5 *
      Math.hypot(
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      );
  }
  return a;
}
