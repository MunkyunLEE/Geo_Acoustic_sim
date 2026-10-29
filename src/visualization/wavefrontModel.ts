import { BAND_CENTERS, type PerBand, type Vec3 } from '../types';
import { specularFactor, type CompiledScene } from '../solver/core/compile';
import { spreadingGain } from '../solver/physics/direct';
import { closestHit } from '../solver/tracing/bvh';
import { colormap, levelToT } from './colormap';

const NB = BAND_CENTERS.length; // 밴드 수

/** 고정 시드 난수 (mulberry32). 재현성 확보. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 구 위 균일에 가까운 방향과 삼각형 위상을 가진 icosphere (정이십면체 세분). */
export function icosphere(level: number): { dirs: Float32Array; faces: Uint32Array } {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: number[][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((p) => {
    const l = Math.hypot(p[0]!, p[1]!, p[2]!);
    return [p[0]! / l, p[1]! / l, p[2]! / l];
  });
  let f: number[][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const cache = new Map<number, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      let i = cache.get(key);
      if (i === undefined) {
        const m = [
          (v[a]![0]! + v[b]![0]!) / 2,
          (v[a]![1]! + v[b]![1]!) / 2,
          (v[a]![2]! + v[b]![2]!) / 2,
        ];
        const len = Math.hypot(m[0]!, m[1]!, m[2]!);
        i = v.length;
        v.push([m[0]! / len, m[1]! / len, m[2]! / len]);
        cache.set(key, i);
      }
      return i;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of f as [number, number, number][]) {
      const ab = mid(a, b),
        bc = mid(b, c),
        ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    f = nf;
  }
  return { dirs: Float32Array.from(v.flat()), faces: Uint32Array.from(f.flat()) };
}

/** 레벨 계산용 거리 감쇠 표 (밴드별). 파면 입자와 이미지 소스가 같은 spreadingGain을 쓴다. */
export interface SpreadLut {
  rMax: number; // 표의 최대 경로 길이 [m]
  size: number;
  gain: Float32Array[]; // 밴드별 이득, 균일 간격
}

export function makeSpreadLut(rMax: number, alpha: PerBand<number>, size = 1024): SpreadLut {
  const gain = BAND_CENTERS.map((fc) => {
    const g = new Float32Array(size);
    for (let i = 0; i < size; i++) g[i] = spreadingGain((i / (size - 1)) * rMax, alpha[fc]);
    return g;
  });
  return { rMax, size, gain };
}

/** 반사를 따라가는 파면 모델. 광선마다 세그먼트(직선 구간)를 저장한다. */
export interface WaveModel {
  n: number; // 광선(입자) 수
  src: Vec3;
  maxSeg: number; // 광선당 최대 세그먼트 수 (= 최대 반사 차수 + 1)
  dirs: Float32Array; // 초기 방향 (3n)
  faces: Uint32Array; // 표면 표시용 삼각형 (icosphere 위상)
  segCount: Uint8Array; // 광선별 세그먼트 수
  segL0: Float32Array; // 세그먼트 시작 경로 길이 [m] (n × maxSeg)
  segLen: Float32Array; // 세그먼트 길이 [m]
  segOrigin: Float32Array; // 세그먼트 시작점 (n × maxSeg × 3)
  segDir: Float32Array; // 세그먼트 진행 방향 (n × maxSeg × 3)
  segE: Float32Array; // 세그먼트 시작까지의 정반사 에너지 계수 (n × maxSeg × 6)
  endLen: Float32Array; // 광선이 사라지는 총 경로 길이 [m]
  jitter: Float32Array; // 껍질 안 위치 [0,1) (고정 시드)
  rMax: number; // 최대 총 경로 길이 [m]
}

/**
 * 음원에서 icosphere 방향으로 광선을 쏘고 maxOrder회까지 정반사를 따라간다.
 * 소산 면(반사 계수 0)에 닿거나 최대 차수에 닿으면 그 광선은 거기서 사라진다.
 * 입자 색은 이미지 소스 레벨과 같은 식(경로 길이 r에서 E·spreadingGain(r))이다.
 */
export function buildWaveModel(
  c: CompiledScene,
  src: Vec3,
  maxOrder: number, // 최대 반사 차수
  level = 6, // icosphere 세분 단계
  seed = 20261021,
): WaveModel {
  const { dirs, faces } = icosphere(level);
  const n = dirs.length / 3;
  const maxSeg = maxOrder + 1;
  const segCount = new Uint8Array(n);
  const segL0 = new Float32Array(n * maxSeg);
  const segLen = new Float32Array(n * maxSeg);
  const segOrigin = new Float32Array(n * maxSeg * 3);
  const segDir = new Float32Array(n * maxSeg * 3);
  const segE = new Float32Array(n * maxSeg * NB);
  const endLen = new Float32Array(n);
  const jitter = new Float32Array(n);
  const rnd = mulberry32(seed);
  const reflCache = new Map<string, PerBand<number>>();
  let rMax = 0;

  for (let i = 0; i < n; i++) {
    jitter[i] = rnd();
    let pos: Vec3 = [src[0], src[1], src[2]];
    let dir: Vec3 = [dirs[i * 3]!, dirs[i * 3 + 1]!, dirs[i * 3 + 2]!];
    let L = 0;
    const E = new Float64Array(NB).fill(1);
    for (let k = 0; k < maxSeg; k++) {
      const hit = closestHit(c.bvhAll, pos, dir, c.eps, Infinity);
      const len = hit ? hit.t : c.diag * 2;
      const o = i * maxSeg + k;
      segL0[o] = L;
      segLen[o] = len;
      segOrigin.set(pos, o * 3);
      segDir.set(dir, o * 3);
      for (let b = 0; b < NB; b++) segE[o * NB + b] = E[b]!;
      segCount[i] = k + 1;
      L += len;
      if (!hit || k === maxSeg - 1) break;
      const mat = c.materialOfTri[hit.triIndex]!;
      let refl = reflCache.get(mat.id);
      if (!refl) reflCache.set(mat.id, (refl = specularFactor(mat)));
      let live = false;
      for (let b = 0; b < NB; b++) {
        E[b] = E[b]! * refl[BAND_CENTERS[b]!];
        if (E[b]! > 1e-9) live = true;
      }
      if (!live) break; // 소산 면: 광선 소멸
      const nx = c.triNormal[hit.triIndex * 3]!,
        ny = c.triNormal[hit.triIndex * 3 + 1]!,
        nz = c.triNormal[hit.triIndex * 3 + 2]!;
      const dn = dir[0] * nx + dir[1] * ny + dir[2] * nz;
      pos = [pos[0] + dir[0] * hit.t, pos[1] + dir[1] * hit.t, pos[2] + dir[2] * hit.t];
      dir = [dir[0] - 2 * dn * nx, dir[1] - 2 * dn * ny, dir[2] - 2 * dn * nz];
    }
    endLen[i] = L;
    rMax = Math.max(rMax, L);
  }
  return {
    n,
    src,
    maxSeg,
    dirs,
    faces,
    segCount,
    segL0,
    segLen,
    segOrigin,
    segDir,
    segE,
    endLen,
    jitter,
    rMax,
  };
}

/** 파면 채우기 결과 버퍼. */
export interface WaveFrame {
  positions: Float32Array; // 3n, 광선 번호 순서 (죽은 광선은 갱신하지 않음)
  colors: Float32Array; // 3n, 0~1
  alive: Uint8Array; // n
}

export function makeWaveFrame(n: number): WaveFrame {
  return {
    positions: new Float32Array(n * 3),
    colors: new Float32Array(n * 3),
    alive: new Uint8Array(n),
  };
}

/**
 * 경로 길이 radius의 파면 위치·색을 채운다. thickness > 0이면 [radius − thickness, radius] 구간에 흩뿌린다(점 표시),
 * 0이면 정확히 radius(면 표시). 색은 Σ w_b E_b g_b(r)의 dB를 컬러맵에 넣는다.
 */
export function fillWave(
  m: WaveModel,
  radius: number, // 현재 파면 경로 길이 [m]
  thickness: number, // 껍질 두께 [m]
  lut: SpreadLut,
  weights: readonly number[], // 밴드 가중치 (selectionWeights)
  minDb: number, // 컬러맵 하한 [dB]
  out: WaveFrame,
): void {
  const scale = (lut.size - 1) / lut.rMax;
  for (let i = 0; i < m.n; i++) {
    const r = radius - m.jitter[i]! * thickness;
    out.alive[i] = 0;
    if (r <= 0 || r >= m.endLen[i]!) continue;
    let k = m.segCount[i]! - 1;
    while (k > 0 && m.segL0[i * m.maxSeg + k]! > r) k--;
    const o = i * m.maxSeg + k;
    const t = r - m.segL0[o]!;
    out.positions[i * 3] = m.segOrigin[o * 3]! + m.segDir[o * 3]! * t;
    out.positions[i * 3 + 1] = m.segOrigin[o * 3 + 1]! + m.segDir[o * 3 + 1]! * t;
    out.positions[i * 3 + 2] = m.segOrigin[o * 3 + 2]! + m.segDir[o * 3 + 2]! * t;
    const x = Math.min(r * scale, lut.size - 1.001);
    const j = Math.floor(x),
      f = x - j;
    let sum = 0;
    for (let b = 0; b < NB; b++) {
      const g = lut.gain[b]!;
      sum += weights[b]! * m.segE[o * NB + b]! * (g[j]! * (1 - f) + g[j + 1]! * f);
    }
    const db = sum > 0 ? 10 * Math.log10(sum) : Number.NEGATIVE_INFINITY;
    const col = colormap(levelToT(db, minDb));
    out.colors[i * 3] = col[0] / 255;
    out.colors[i * 3 + 1] = col[1] / 255;
    out.colors[i * 3 + 2] = col[2] / 255;
    out.alive[i] = 1;
  }
}

/**
 * 표면 표시용 삼각형 인덱스를 만든다. 세 꼭짓점이 모두 살아 있고 서로 가까울 때만 그린다
 * (벽에서 끊기거나 그림자로 갈라진 곳에서 길게 늘어난 삼각형을 막는다). 그린 인덱스 개수를 반환한다.
 */
export function buildSurfaceIndices(
  m: WaveModel,
  frame: WaveFrame,
  radius: number, // 현재 경로 길이 [m] (공칭 간격 계산용)
  level: number, // icosphere 단계
  out: Uint32Array, // 출력 인덱스 (faces와 같은 길이 이상)
): number {
  const nominal = (1.0515 / Math.pow(2, level)) * radius; // 공칭 모서리 길이 (단위 구 정이십면체 모서리 ≈ 1.0515)
  const limit2 = (3 * nominal) ** 2;
  let n = 0;
  const p = frame.positions;
  const d2 = (a: number, b: number) =>
    (p[a * 3]! - p[b * 3]!) ** 2 +
    (p[a * 3 + 1]! - p[b * 3 + 1]!) ** 2 +
    (p[a * 3 + 2]! - p[b * 3 + 2]!) ** 2;
  for (let f = 0; f < m.faces.length; f += 3) {
    const a = m.faces[f]!,
      b = m.faces[f + 1]!,
      c = m.faces[f + 2]!;
    if (!frame.alive[a] || !frame.alive[b] || !frame.alive[c]) continue;
    if (d2(a, b) > limit2 || d2(b, c) > limit2 || d2(c, a) > limit2) continue;
    out[n++] = a;
    out[n++] = b;
    out[n++] = c;
  }
  return n;
}
