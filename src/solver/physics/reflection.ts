import type { PerBand, Vec3 } from '../../types';
import type { CompiledScene, ReflectorPlane } from '../core/compile';
import { perBand } from '../core/bands';
import { closestHit, segmentVisible } from '../tracing/bvh';
import { spreadingGain } from './direct';

/** 정반사 경로 후보: 음원을 평면 순서대로 거울 반사한 이미지 음원 (물리 문서: 이미지 소스법). */
export interface ImagePath {
  order: number; // 반사 차수 k
  planeIds: number[]; // 반사 평면 순서 (compiled.planes 인덱스)
  images: Vec3[]; // images[0] = 음원, images[j] = j번 반사한 이미지
  refl: PerBand<number>; // 경로 전체의 정반사 에너지 계수 Π(1−α)(1−s)
}

export interface ImageSet {
  paths: ImagePath[];
  order: number; // 실제로 생성된 최대 차수 (상한 초과 시 요청보다 작을 수 있음)
  truncated: boolean; // true면 경로 수 상한 때문에 차수를 줄였다
}

/** 점 p를 평면 (n·x = d)에 대해 거울 반사한다. */
export function mirror(p: Vec3, pl: ReflectorPlane): Vec3 {
  const k = 2 * (pl.n[0] * p[0] + pl.n[1] * p[1] + pl.n[2] * p[2] - pl.d);
  return [p[0] - k * pl.n[0], p[1] - k * pl.n[1], p[2] - k * pl.n[2]];
}

const MAX_PATHS = 6000; // 이미지 경로 수 상한 (브라우저 계산 시간 보호)

/** 음원의 이미지 경로를 maxOrder 차수까지 만든다. 연속으로 같은 평면에서 반사하는 경로는 제외. */
export function buildImagePaths(c: CompiledScene, src: Vec3, maxOrder: number): ImageSet {
  const paths: ImagePath[] = [];
  let frontier: ImagePath[] = [{ order: 0, planeIds: [], images: [src], refl: perBand(() => 1) }];
  let reached = 0;
  let truncated = false;
  for (let k = 1; k <= maxOrder; k++) {
    const next: ImagePath[] = [];
    for (const base of frontier) {
      const last = base.planeIds[base.planeIds.length - 1];
      for (let i = 0; i < c.planes.length; i++) {
        if (i === last) continue;
        const pl = c.planes[i]!;
        const img = mirror(base.images[base.images.length - 1]!, pl);
        next.push({
          order: k,
          planeIds: [...base.planeIds, i],
          images: [...base.images, img],
          refl: perBand((fc) => base.refl[fc] * pl.refl[fc]),
        });
      }
    }
    if (paths.length + next.length > MAX_PATHS) {
      truncated = true;
      break;
    }
    paths.push(...next);
    frontier = next;
    reached = k;
  }
  return { paths, order: reached, truncated };
}

/** 점 p(평면 위)가 평면에 속한 삼각형 안에 있는지. 작은 그룹은 직접 검사, 큰 그룹은 BVH로. */
function insidePlaneTris(c: CompiledScene, planeId: number, p: Vec3): boolean {
  const pl = c.planes[planeId]!;
  if (pl.triCount <= 64) {
    const t = pl.tris;
    for (let i = 0; i < pl.triCount; i++) {
      const o = i * 9;
      const vx = p[0] - t[o]!,
        vy = p[1] - t[o + 1]!,
        vz = p[2] - t[o + 2]!;
      const d00 = t[o + 3]! * t[o + 3]! + t[o + 4]! * t[o + 4]! + t[o + 5]! * t[o + 5]!;
      const d01 = t[o + 3]! * t[o + 6]! + t[o + 4]! * t[o + 7]! + t[o + 5]! * t[o + 8]!;
      const d11 = t[o + 6]! * t[o + 6]! + t[o + 7]! * t[o + 7]! + t[o + 8]! * t[o + 8]!;
      const d20 = vx * t[o + 3]! + vy * t[o + 4]! + vz * t[o + 5]!;
      const d21 = vx * t[o + 6]! + vy * t[o + 7]! + vz * t[o + 8]!;
      const den = d00 * d11 - d01 * d01;
      if (den === 0) continue;
      const u = (d11 * d20 - d01 * d21) / den;
      const w = (d00 * d21 - d01 * d20) / den;
      const tol = 1e-7; // 경계 포함 허용 오차 (무차원)
      if (u >= -tol && w >= -tol && u + w <= 1 + tol) return true;
    }
    return false;
  }
  const h = 10 * c.eps; // 평면에서 떨어뜨려 쏘는 거리
  const o: Vec3 = [p[0] + pl.n[0] * h, p[1] + pl.n[1] * h, p[2] + pl.n[2] * h];
  const hit = closestHit(c.bvhAll, o, [-pl.n[0], -pl.n[1], -pl.n[2]], 0, 2 * h);
  return hit !== null && c.triPlane[hit.triIndex] === planeId;
}

/**
 * 이미지 경로가 수음점 rcv에서 유효한지 검사한다 (물리 문서: 경로 유효성).
 * 유효하면 [음원, 반사점들..., 수음점]을, 아니면 null을 돌려준다.
 */
export function validatePath(c: CompiledScene, path: ImagePath, rcv: Vec3): Vec3[] | null {
  const k = path.order;
  const pts: Vec3[] = new Array(k + 2);
  pts[k + 1] = rcv;
  let cur = rcv;
  for (let j = k; j >= 1; j--) {
    const pl = c.planes[path.planeIds[j - 1]!]!;
    const tgt = path.images[j]!;
    const dx = tgt[0] - cur[0],
      dy = tgt[1] - cur[1],
      dz = tgt[2] - cur[2];
    const den = pl.n[0] * dx + pl.n[1] * dy + pl.n[2] * dz;
    if (Math.abs(den) < 1e-14) return null;
    const t = (pl.d - (pl.n[0] * cur[0] + pl.n[1] * cur[1] + pl.n[2] * cur[2])) / den;
    if (!(t > 1e-9 && t < 1 - 1e-9)) return null; // 선분 안에서 평면을 지나야 함
    const P: Vec3 = [cur[0] + t * dx, cur[1] + t * dy, cur[2] + t * dz];
    if (!insidePlaneTris(c, path.planeIds[j - 1]!, P)) return null;
    pts[j] = P;
    cur = P;
  }
  pts[0] = path.images[0]!;
  for (let i = 0; i < pts.length - 1; i++)
    if (!segmentVisible(c.bvhObjects, pts[i]!, pts[i + 1]!, c.eps)) return null;
  return pts;
}

export interface ReflectionResult {
  gain: PerBand<number>; // 밴드별 반사음 상대 에너지 이득 (자유장 1 m = 1)
  nValid: number; // 유효한 반사 경로 수
}

/** 수음점에서 유효한 정반사 경로들의 에너지를 합산한다 (비간섭 합, 근사). */
export function reflectionGains(
  c: CompiledScene,
  set: ImageSet,
  rcv: Vec3,
  alpha: PerBand<number>, // 밴드별 공기 흡음 [dB/m]
): ReflectionResult {
  const g = { 125: 0, 250: 0, 500: 0, 1000: 0, 2000: 0, 4000: 0 } as Record<number, number>;
  let n = 0;
  for (const path of set.paths) {
    if (!validatePath(c, path, rcv)) continue;
    const img = path.images[path.order]!;
    const len = Math.hypot(rcv[0] - img[0], rcv[1] - img[1], rcv[2] - img[2]);
    n++;
    for (const k of Object.keys(g)) {
      const fc = Number(k) as keyof PerBand<number>;
      g[fc] += path.refl[fc] * spreadingGain(len, alpha[fc]);
    }
  }
  return { gain: g as unknown as PerBand<number>, nValid: n };
}
