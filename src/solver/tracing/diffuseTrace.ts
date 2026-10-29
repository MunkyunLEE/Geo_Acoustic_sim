import {
  BAND_CENTERS,
  type PerBand,
  type PointSource,
  type Receiver,
  type Vec3,
} from '../../types';
import { transmissionOf, type CompiledScene } from '../core/compile';
import { mulberry32 } from '../../visualization/wavefrontModel';
import type { DiffuseField, EnergyBalance, VoxelGrid } from '../physics/diffuse';
import { closestHit } from './bvh';

const NB = BAND_CENTERS.length;
const LN10_10 = Math.LN10 / 10; // dB → 자연 지수

/** 몬테카를로 설정. 모두 고정 시드로 재현된다. */
export interface DiffuseSettings {
  raysPerBand: number; // 음원·밴드당 레이 수
  maxBounces: number; // 레이당 최대 반사 횟수
  seed: number; // 난수 시드
  batches: number; // 표준오차용 배치 수 (레이를 균등 분할)
  gridCells: number; // 복셀 격자의 긴 변 셀 수
  eMin: number; // 이 비율(초기 에너지 대비) 미만이면 추적 중단
  echoDtMs: number; // 에코그램 시간 간격 [ms]
  echoMaxMs: number; // 에코그램 최대 시간 [ms]
}

export const DEFAULT_DIFFUSE: DiffuseSettings = {
  raysPerBand: 5000,
  maxBounces: 60,
  seed: 20261021,
  batches: 8,
  gridCells: 40,
  eMin: 1e-6,
  echoDtMs: 2,
  echoMaxMs: 400,
};

export interface DiffuseInput {
  c: CompiledScene;
  sources: readonly PointSource[];
  receivers: readonly Receiver[];
  alpha: PerBand<number>; // 공기 흡음 [dB/m]
  countFrom: readonly number[]; // 음원별: 이 반사 차수 이상의 순수 정반사 구간도 집계 (미만은 이미지 음원 담당)
  speed: number; // 음속 [m/s] (에코그램 시간축)
  settings: DiffuseSettings;
  onlyBands?: readonly number[]; // 계산할 밴드 번호 (생략하면 전부). 시험·성능 확인용
  onProgress?: (done: number, total: number) => void;
}

/** 코사인 가중 반구 샘플 (램버트). n은 단위 법선, u1·u2는 [0,1) 난수. 반환은 단위 벡터. */
export function cosineSample(n: Vec3, u1: number, u2: number): Vec3 {
  const r = Math.sqrt(u1);
  const phi = 2 * Math.PI * u2;
  const x = r * Math.cos(phi);
  const y = r * Math.sin(phi);
  const z = Math.sqrt(Math.max(0, 1 - u1));
  // n에 수직인 직교 기저
  const a: Vec3 = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  let tx = a[1] * n[2] - a[2] * n[1];
  let ty = a[2] * n[0] - a[0] * n[2];
  let tz = a[0] * n[1] - a[1] * n[0];
  const tl = Math.hypot(tx, ty, tz);
  tx /= tl;
  ty /= tl;
  tz /= tl;
  const bx = n[1] * tz - n[2] * ty;
  const by = n[2] * tx - n[0] * tz;
  const bz = n[0] * ty - n[1] * tx;
  return [x * tx + y * bx + z * n[0], x * ty + y * by + z * n[1], x * tz + y * bz + z * n[2]];
}

/** 등방 음원의 균일 구면 방향. */
export function uniformSphere(u1: number, u2: number): Vec3 {
  const z = 1 - 2 * u1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const phi = 2 * Math.PI * u2;
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

/** 복셀 격자를 영역에 맞춰 만든다 (긴 변 gridCells개, 축별 셀 크기는 영역을 정확히 나눔). */
export function makeGrid(min: Vec3, max: Vec3, cells: number): VoxelGrid {
  const dim = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const h0 = Math.max(...dim, 1e-6) / cells;
  const n = dim.map((d) => Math.max(1, Math.round(d / h0))) as [number, number, number];
  return { min, n, h: [dim[0]! / n[0], dim[1]! / n[1], dim[2]! / n[2]] };
}

/**
 * 구간(시작점 o, 방향 d, 길이 len)을 복셀에 누적한다 (Amanatides–Woo).
 * 구간 에너지는 시작 에너지 e0에 공기 감쇠 exp(-k·s)를 곱해 복셀마다 중점에서 평가한다.
 */
function depositGrid(
  acc: Float64Array,
  g: VoxelGrid,
  o: Vec3,
  d: Vec3,
  len: number,
  e0: number,
  airK: number, // 공기 감쇠 [1/m] (에너지)
  pathL: number, // 구간 시작까지의 경로 길이 [m]
): void {
  const [nx, ny] = g.n;
  const pos = [0, 0, 0];
  const cell = [0, 0, 0];
  const step = [0, 0, 0];
  const tNext = [0, 0, 0];
  const tDelta = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    pos[a] = o[a]!;
    const u = (o[a]! - g.min[a]!) / g.h[a]!;
    cell[a] = Math.min(Math.max(Math.floor(u), 0), g.n[a]! - 1);
    if (d[a]! > 0) {
      step[a] = 1;
      tNext[a] = ((cell[a]! + 1) * g.h[a]! + g.min[a]! - o[a]!) / d[a]!;
      tDelta[a] = g.h[a]! / d[a]!;
    } else if (d[a]! < 0) {
      step[a] = -1;
      tNext[a] = (cell[a]! * g.h[a]! + g.min[a]! - o[a]!) / d[a]!;
      tDelta[a] = -g.h[a]! / d[a]!;
    } else {
      step[a] = 0;
      tNext[a] = Infinity;
      tDelta[a] = Infinity;
    }
  }
  let t = 0;
  while (t < len) {
    const a =
      tNext[0]! < tNext[1]! ? (tNext[0]! < tNext[2]! ? 0 : 2) : tNext[1]! < tNext[2]! ? 1 : 2;
    const t1 = Math.min(tNext[a]!, len);
    const chord = t1 - t;
    if (chord > 0) {
      acc[(cell[2]! * ny + cell[1]!) * nx + cell[0]!]! +=
        e0 * Math.exp(-airK * (pathL + 0.5 * (t + t1))) * chord;
    }
    t = t1;
    if (t >= len) break;
    cell[a] = cell[a]! + step[a]!;
    if (cell[a]! < 0 || cell[a]! >= g.n[a]!) break; // 격자 밖 (영역 경계 수치 오차)
    tNext[a] = tNext[a]! + tDelta[a]!;
  }
}

/**
 * 확산 성분 몬테카를로 추적. 음원·밴드마다 독립이다.
 * - 표면에서 흡수 α, 투과 τ, 나머지는 반사. 반사는 확률 s로 램버트(확산), 아니면 정반사.
 *   투과는 면을 그대로 통과(방향 유지)하며 에너지 가중치는 그대로 두고 확률 τ/(1−α)로 분기한다.
 * - 집계 규칙(이중 집계 방지): 확산 반사를 겪은 구간, 반사 차수 ≥ countFrom인 구간, 투과 후 반사한 구간을 집계한다.
 *   반사 0회(직접 + 투과만)와 낮은 차수의 순수 정반사는 해석식(이미지 음원)이 계산한다.
 * - 수신 구 track-length 추정자: 이득 = 4π·Σ(에너지·구 안 길이) / V. 같은 합을 도달 시간 구간에도 나눠 담아 에코그램을 만든다.
 * - 표면 입사: 모든 충돌의 입사 에너지를 삼각형별로 모은다 (4π·Σe / A).
 */
export function traceDiffuse(inp: DiffuseInput): DiffuseField {
  const { c, sources, receivers, alpha, settings: st } = inp;
  const nS = sources.length;
  const nR = receivers.length;
  const B = Math.max(1, st.batches);
  const grid = makeGrid(c.scene.domain.min, c.scene.domain.max, st.gridCells);
  const nv = grid.n[0] * grid.n[1] * grid.n[2];
  const vVox = grid.h[0] * grid.h[1] * grid.h[2];
  const nTri = c.triNormal.length / 3;
  const nBins = Math.max(1, Math.ceil(st.echoMaxMs / st.echoDtMs));
  const dt = st.echoDtMs / 1000; // [s]
  const rcv = new Float32Array(nS * nR * NB);
  const rcvSe = new Float32Array(nS * nR * NB);
  const vox = new Float32Array(nS * NB * nv);
  const echo = new Float32Array(nS * nR * NB * nBins);
  const surf = new Float32Array(nS * NB * nTri);
  const balance: EnergyBalance[] = [];
  const vRcv = receivers.map((r) => (4 / 3) * Math.PI * r.radius ** 3);
  const bandsToRun = inp.onlyBands ?? BAND_CENTERS.map((_, i) => i);
  // 면음원 표본점은 점마다 레이를 나눠 쓴다 (전체 레이 수 유지, 최소 B×20개)
  const perBatchOf = sources.map((s) =>
    Math.max(
      s.samples && s.samples > 1 ? 20 : 1,
      Math.floor(st.raysPerBand / (s.samples ?? 1) / B),
    ),
  );
  const total = bandsToRun.length * B * nS;
  let done = 0;

  for (let s = 0; s < nS; s++) {
    const src = sources[s]!.position;
    const perBatch = perBatchOf[s]!;
    const nRays = perBatch * B;
    for (const b of bandsToRun) {
      const fc = BAND_CENTERS[b]!;
      const airK = alpha[fc] * LN10_10; // 에너지 지수 감쇠 [1/m]
      const rnd = mulberry32(st.seed + s * 7919 + b * 104729);
      const e0 = 1 / nRays;
      const T = new Float64Array(B * nR); // 배치별 수신 구 track-length 합
      const TE = new Float64Array(nR * nBins); // 수신점·시간 구간별 합
      const G = new Float64Array(nv);
      const SF = new Float64Array(nTri);
      let absorbed = 0;
      let air = 0;
      let residual = 0;
      for (let bt = 0; bt < B; bt++) {
        for (let i = 0; i < perBatch; i++) {
          let pos: Vec3 = [src[0], src[1], src[2]];
          let dir = uniformSphere(rnd(), rnd());
          let E = e0;
          let L = 0;
          let diffuse = 0; // 확산 반사 횟수
          let nRefl = 0; // 반사 횟수 (정반사 + 확산)
          let nTrans = 0; // 투과 횟수
          for (let k = 0; k <= st.maxBounces; k++) {
            const hit = closestHit(c.bvhAll, pos, dir, c.eps, Infinity);
            if (!hit) {
              residual += E; // 수치 오차로 영역 밖으로 나간 경우
              break;
            }
            const len = hit.t;
            if (diffuse > 0 || nRefl >= inp.countFrom[s]! || (nTrans > 0 && nRefl > 0)) {
              for (let r = 0; r < nR; r++) {
                const cx = receivers[r]!.position;
                const ox = cx[0] - pos[0];
                const oy = cx[1] - pos[1];
                const oz = cx[2] - pos[2];
                const tc = ox * dir[0] + oy * dir[1] + oz * dir[2];
                const rr = receivers[r]!.radius;
                const d2 = ox * ox + oy * oy + oz * oz - tc * tc;
                if (d2 >= rr * rr) continue;
                const hh = Math.sqrt(rr * rr - d2);
                const t0 = Math.max(0, tc - hh);
                const t1 = Math.min(len, tc + hh);
                if (t1 > t0) {
                  const w = E * Math.exp(-airK * (L + 0.5 * (t0 + t1))) * (t1 - t0);
                  T[bt * nR + r] += w;
                  const bin = Math.floor((L + 0.5 * (t0 + t1)) / inp.speed / dt);
                  if (bin < nBins) TE[r * nBins + bin] += w;
                }
              }
              depositGrid(G, grid, pos, dir, len, E, airK, L);
            }
            const Eend = E * Math.exp(-airK * len);
            air += E - Eend;
            SF[hit.triIndex] += Eend; // 표면 입사 에너지 (모든 충돌)
            const mat = c.materialOfTri[hit.triIndex]!;
            const a = mat.absorption[fc];
            absorbed += Eend * a;
            E = Eend * (1 - a);
            L += len;
            if (E < e0 * st.eMin || k === st.maxBounces) {
              residual += E;
              break;
            }
            pos = [pos[0] + dir[0] * len, pos[1] + dir[1] * len, pos[2] + dir[2] * len];
            const tau = transmissionOf(mat, fc);
            if (tau > 0 && rnd() < tau / (1 - a)) {
              nTrans++; // 면을 그대로 통과
              continue;
            }
            const ti = hit.triIndex * 3;
            let nx = c.triNormal[ti]!;
            let ny = c.triNormal[ti + 1]!;
            let nz = c.triNormal[ti + 2]!;
            if (dir[0] * nx + dir[1] * ny + dir[2] * nz > 0) {
              nx = -nx;
              ny = -ny;
              nz = -nz; // 입사면 쪽 법선
            }
            nRefl++;
            if (rnd() < mat.scattering[fc]) {
              dir = cosineSample([nx, ny, nz], rnd(), rnd());
              diffuse++;
            } else {
              const dn = dir[0] * nx + dir[1] * ny + dir[2] * nz;
              dir = [dir[0] - 2 * dn * nx, dir[1] - 2 * dn * ny, dir[2] - 2 * dn * nz];
            }
          }
        }
        done++;
        inp.onProgress?.(done, total);
      }
      for (let r = 0; r < nR; r++) {
        // 배치별 이득 g_b = 4π·B·T_b / V → 평균과 평균의 표준오차
        const gb: number[] = [];
        for (let bt = 0; bt < B; bt++) gb.push((4 * Math.PI * B * T[bt * nR + r]!) / vRcv[r]!);
        const mean = gb.reduce((x, y) => x + y, 0) / B;
        const varr = B > 1 ? gb.reduce((x, y) => x + (y - mean) ** 2, 0) / (B - 1) : 0;
        rcv[(s * nR + r) * NB + b] = mean;
        rcvSe[(s * nR + r) * NB + b] = Math.sqrt(varr / B);
        const eo = ((s * nR + r) * NB + b) * nBins;
        for (let q = 0; q < nBins; q++)
          echo[eo + q] = (4 * Math.PI * TE[r * nBins + q]!) / vRcv[r]!;
      }
      const o = (s * NB + b) * nv;
      for (let v = 0; v < nv; v++) vox[o + v] = (4 * Math.PI * G[v]!) / vVox;
      const so = (s * NB + b) * nTri;
      for (let t = 0; t < nTri; t++) {
        const area = c.triArea[t]!;
        surf[so + t] = area > 1e-12 ? (4 * Math.PI * SF[t]!) / area : 0;
      }
      balance.push({ src: s, band: b, absorbed, air, residual });
    }
  }
  return {
    nSrc: nS,
    nRcv: nR,
    rcv,
    rcvSe,
    grid,
    vox,
    echo,
    echoDt: dt,
    echoBins: nBins,
    surf,
    nTri,
    rays: perBatchOf[0]! * B * (sources[0]?.samples ?? 1),
    seed: st.seed,
    balance,
    countFrom: [...inp.countFrom],
  };
}
