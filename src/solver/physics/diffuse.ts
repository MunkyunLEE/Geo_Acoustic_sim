import { BAND_CENTERS, type PerBand, type Vec3 } from '../../types';
import { perBand } from '../core/bands';

const NB = BAND_CENTERS.length; // 밴드 수 (6)

/** 3D 복셀 격자. 점 조회는 셀 중심 기준 삼선형 보간. */
export interface VoxelGrid {
  min: Vec3; // 격자 최소점 [m]
  n: [number, number, number]; // 축별 셀 수
  h: Vec3; // 축별 셀 크기 [m]
}

/**
 * 확산 성분(확산 반사를 겪은 경로 + 추적 차수를 넘는 정반사 경로)의 몬테카를로 결과.
 * 값은 모두 "음원 대비 상대 에너지 이득"(자유장 1 m = 1)이며 STEP 2의 밴드별 이득과 같은 단위다.
 */
export interface DiffuseField {
  nSrc: number; // 음원 수
  nRcv: number; // 수신점 수
  rcv: Float32Array; // 수신 구 이득 [음원][수신점][밴드]
  rcvSe: Float32Array; // 배치 표준오차 (같은 배치)
  grid: VoxelGrid; // 슬라이스용 격자
  vox: Float32Array; // 복셀 이득 [음원][밴드][복셀]
  echo: Float32Array; // 시간 구간별 이득 [음원][수신점][밴드][구간] (합 = 수신 구 이득)
  echoDt: number; // 에코그램 구간 폭 [s]
  echoBins: number; // 구간 수
  surf: Float32Array; // 삼각형별 입사 이득 4πΣe/A [음원][밴드][전체 삼각형]
  nTri: number; // 전체 삼각형 수 (영역 면 포함, bvhAll 번호)
  rays: number; // 밴드당 레이 수
  seed: number;
  balance: EnergyBalance[]; // 음원·밴드별 에너지 수지
  countFrom: number[]; // 음원별 MC 집계 시작 차수 (이 차수 미만의 순수 정반사는 이미지 음원이 계산)
}

/** 레이 에너지 수지 (방출 에너지 = 1로 정규화). */
export interface EnergyBalance {
  src: number;
  band: number;
  absorbed: number; // 표면 흡수
  air: number; // 공기 흡수
  residual: number; // 에너지 하한·최대 반사 횟수로 중단된 잔여
}

export const emptyBands = (): PerBand<number> => perBand(() => 0);

/** 수신점 s, r의 이득 (밴드별). */
export function diffuseAtReceiver(d: DiffuseField, s: number, r: number): PerBand<number> {
  const o = (s * d.nRcv + r) * NB;
  return perBand((fc) => d.rcv[o + BAND_CENTERS.indexOf(fc)]!);
}

/** 수신점 s, r의 표준오차 (밴드별, 이득 단위). */
export function diffuseSeAtReceiver(d: DiffuseField, s: number, r: number): PerBand<number> {
  const o = (s * d.nRcv + r) * NB;
  return perBand((fc) => d.rcvSe[o + BAND_CENTERS.indexOf(fc)]!);
}

/** 임의의 점 p의 이득 (복셀 중심 삼선형 보간, 경계 밖은 가장자리 값). */
export function diffuseAtPoint(d: DiffuseField, s: number, p: Vec3): PerBand<number> {
  const g = d.grid;
  const i0: number[] = []; // 축별 아래쪽 셀
  const i1: number[] = []; // 축별 위쪽 셀
  const f: number[] = []; // 축별 보간 비율
  for (let a = 0; a < 3; a++) {
    const u = (p[a]! - g.min[a]!) / g.h[a]! - 0.5; // 셀 중심 좌표계
    const lo = Math.min(Math.max(Math.floor(u), 0), g.n[a]! - 1);
    i0.push(lo);
    i1.push(Math.min(lo + 1, g.n[a]! - 1));
    f.push(Math.min(Math.max(u - lo, 0), 1));
  }
  const [nx, ny] = g.n;
  const nv = nx * ny * g.n[2]!;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return perBand((fc) => {
    const base = (s * NB + BAND_CENTERS.indexOf(fc)) * nv;
    const at = (i: number, j: number, k: number) => d.vox[base + (k * ny + j) * nx + i]!;
    const plane = (k: number) =>
      lerp(
        lerp(at(i0[0]!, i0[1]!, k), at(i1[0]!, i0[1]!, k), f[0]!),
        lerp(at(i0[0]!, i1[1]!, k), at(i1[0]!, i1[1]!, k), f[0]!),
        f[1]!,
      );
    return lerp(plane(i0[2]!), plane(i1[2]!), f[2]!);
  });
}
