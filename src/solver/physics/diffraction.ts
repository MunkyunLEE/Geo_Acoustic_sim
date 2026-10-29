import type { PerBand, Vec3 } from '../../types';
import { perBand } from '../core/bands';
import type { CompiledScene } from '../core/compile';
import { closestHit, segmentVisible } from '../tracing/bvh';
import { spreadingGain } from './direct';

// ───────── 차폐 보정식 (경험식, ISO 9613-2) ─────────

/** 단일 장애물 감쇠 상한 [dB] / 이중 장애물 상한 [dB] (ISO 9613-2). */
export const DZ_CAP_SINGLE = 20;
export const DZ_CAP_DOUBLE = 25;

/**
 * 차폐 감쇠 Dz [dB] = 10log10(3 + (C2/λ)·C3·δ), C2 = 40 (지면 반사를 이미지 소스로 따로 다룰 때, Maekawa 3+20N와 동일).
 * 경험식이다. 기상 보정 Kmet은 1로 둔다. 단일 20 dB, 이중 25 dB로 제한.
 */
function rawDz(delta: number, wavelength: number, edges: number, edgeSpan: number): number {
  const k = (5 * wavelength) / Math.max(edgeSpan, 1e-6);
  const c3 = edges >= 2 ? (1 + k * k) / (1 / 3 + k * k) : 1;
  return 10 * Math.log10(3 + (40 / wavelength) * c3 * delta);
}

export function barrierDz(
  delta: number, // 경로차 δ [m] (우회 경로 길이 − 직선 거리)
  wavelength: number, // 파장 λ [m]
  edges: number, // 우회 경로가 걸치는 모서리 수 (1 또는 2 이상)
  edgeSpan: number, // 이중 회절일 때 첫·마지막 모서리 사이 거리 e [m]
): number {
  if (!(delta > 0)) return 0;
  return Math.min(
    rawDz(delta, wavelength, edges, edgeSpan),
    edges >= 2 ? DZ_CAP_DOUBLE : DZ_CAP_SINGLE,
  );
}

// ───────── 참조해: 반무한 평면의 Fresnel(Kirchhoff) 해 ─────────

/** Fresnel 적분 C(x), S(x) (x ≥ 0). 급수(작은 x)와 점근 급수(큰 x). 검증용 참조 함수. */
function fresnelCS(x: number): [number, number] {
  if (x < 3.5) {
    let c = 0,
      s = 0;
    const a = Math.PI / 2;
    for (let n = 0; n < 60; n++) {
      const sign = n % 2 === 0 ? 1 : -1;
      const f2n = factorial(2 * n),
        f2n1 = f2n * (2 * n + 1);
      c += (sign * Math.pow(a, 2 * n) * Math.pow(x, 4 * n + 1)) / (f2n * (4 * n + 1));
      s += (sign * Math.pow(a, 2 * n + 1) * Math.pow(x, 4 * n + 3)) / (f2n1 * (4 * n + 3));
    }
    return [c, s];
  }
  const t = Math.PI * x * x;
  const f = (1 / (Math.PI * x)) * (1 - 3 / (t * t) + 105 / Math.pow(t, 4));
  const g = (1 / (Math.PI * Math.PI * x * x * x)) * (1 - 15 / (t * t) + 945 / Math.pow(t, 4));
  const ph = t / 2;
  return [0.5 + f * Math.sin(ph) - g * Math.cos(ph), 0.5 - f * Math.cos(ph) - g * Math.sin(ph)];
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/**
 * 반무한 평면 뒤(그림자 N > 0)·앞(N < 0)의 점음원 감쇠 [dB] (Kirchhoff 근사, 참조해).
 * N = 2δ/λ. 그림자 경계 N = 0에서 6.02 dB.
 */
export function kirchhoffHalfPlaneDb(fresnelNumber: number): number {
  const v = Math.sqrt(2 * Math.abs(fresnelNumber)); // 양수 Fresnel 변수
  const sign = fresnelNumber > 0 ? -1 : 1; // 그림자면 v < 0
  const [c, s] = fresnelCS(v);
  const cc = sign * c,
    ss = sign * s;
  const amp = Math.sqrt((0.5 + cc) ** 2 + (0.5 + ss) ** 2) / Math.SQRT2;
  return -20 * Math.log10(amp);
}

// ───────── 경로 탐색: 평면 안 스윕 + 위쪽 볼록 껍질(팽팽한 끈) ─────────

export interface DiffractionPath {
  kind: 'top' | 'left' | 'right'; // 위로 넘는 경로 / 왼쪽·오른쪽으로 돌아가는 경로
  delta: number; // 경로차 δ [m]
  edges: number; // 걸치는 모서리 수
  edgeSpan: number; // 첫·마지막 모서리 간 거리 [m]
  points: Vec3[]; // 음원, 모서리들, 수음점 (표시용)
}

const SWEEP = 12; // 스윕 샘플 수
const BISECT = 9; // 가장자리 이분 횟수

type P2 = [number, number];

/** 위쪽 볼록 껍질 (a 오름차순 점들, 첫 점 S와 마지막 점 R 포함). */
function upperHull(pts: P2[]): P2[] {
  const h: P2[] = [];
  for (const p of pts) {
    while (h.length >= 2) {
      const a = h[h.length - 2]!,
        b = h[h.length - 1]!;
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (cross >= 0)
        h.pop(); // 오른쪽으로 꺾이지 않으면 b는 껍질 위가 아님
      else break;
    }
    h.push(p);
  }
  return h;
}

/** S→R 직선과 평행한 레이를 오프셋 w 방향으로 스윕해 장애물 표면 점을 모은다. */
function scan(
  c: CompiledScene,
  S: Vec3,
  dn: Vec3, // S→R 단위 벡터
  L: number, // |SR|
  w: Vec3, // 오프셋 방향 (dn에 수직인 단위 벡터)
): { hull: P2[]; frame: (a: number, b: number) => Vec3 } | null {
  const bvh = c.bvhObjects;
  if (!bvh?.bounds) return null;
  const { min, max } = bvh.bounds;
  let bmax = -Infinity;
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]])
        bmax = Math.max(bmax, (x - S[0]) * w[0] + (y - S[1]) * w[1] + (z - S[2]) * w[2]);
  if (!(bmax > 1e-6)) return null;

  const eps = c.eps;
  const mk = (a: number, b: number): Vec3 => [
    S[0] + dn[0] * a + w[0] * b,
    S[1] + dn[1] * a + w[1] * b,
    S[2] + dn[2] * a + w[2] * b,
  ];
  // 오프셋 b에서 S쪽/R쪽 레이의 첫 충돌: a 좌표 (없으면 null)
  const hitS = (b: number): number | null => {
    const h = closestHit(bvh, mk(0, b), dn, eps, L);
    return h ? h.t : null;
  };
  const hitR = (b: number): number | null => {
    const o = mk(L, b);
    const h = closestHit(bvh, o, [-dn[0], -dn[1], -dn[2]], eps, L);
    return h ? L - h.t : null;
  };

  const pts: P2[] = [];
  for (const side of [hitS, hitR]) {
    let top = -1; // 충돌이 있는 가장 큰 샘플 번호
    for (let j = 1; j <= SWEEP; j++) {
      const b = (bmax * j) / SWEEP;
      const a = side(b);
      if (a !== null) {
        pts.push([a, b]);
        top = j;
      }
    }
    if (top < 0) continue;
    let lo = (bmax * top) / SWEEP;
    let hi = top === SWEEP ? lo * 1.05 : (bmax * (top + 1)) / SWEEP;
    for (let it = 0; it < BISECT; it++) {
      const mid = (lo + hi) / 2;
      const a = side(mid);
      if (a !== null) {
        lo = mid;
        pts.push([a, mid]);
      } else hi = mid;
    }
  }
  if (pts.length === 0) return null;
  const inside = pts.filter((p) => p[0] > 0 && p[0] < L).sort((p, q) => p[0] - q[0] || q[1] - p[1]);
  const hull = upperHull([[0, 0], ...inside, [L, 0]]);
  return { hull, frame: mk };
}

/** 직선 S–R이 가려졌을 때, 위·왼쪽·오른쪽으로 돌아가는 우회 경로를 찾는다. */
export function findDiffractionPaths(c: CompiledScene, S: Vec3, R: Vec3): DiffractionPath[] {
  const dx = R[0] - S[0],
    dy = R[1] - S[1],
    dz = R[2] - S[2];
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-6 || !c.bvhObjects) return [];
  if (segmentVisible(c.bvhObjects, S, R, c.eps)) return []; // 가려지지 않았으면 회절 경로 없음
  const dn: Vec3 = [dx / L, dy / L, dz / L];
  const horiz = Math.hypot(dn[0], dn[1]);
  if (horiz < 1e-6) return []; // 수직 경로는 지원하지 않음
  const nh: Vec3 = [-dn[1] / horiz, dn[0] / horiz, 0]; // dn에 수직인 수평 벡터 (왼쪽)
  const dzUp = dn[2];
  const upRaw: Vec3 = [-dzUp * dn[0], -dzUp * dn[1], 1 - dzUp * dn[2]]; // z축에서 dn 성분 제거
  const upLen = Math.hypot(upRaw[0], upRaw[1], upRaw[2]);
  const up: Vec3 = [upRaw[0] / upLen, upRaw[1] / upLen, upRaw[2] / upLen];

  const out: DiffractionPath[] = [];
  const dirs: { kind: DiffractionPath['kind']; w: Vec3 }[] = [
    { kind: 'top', w: up },
    { kind: 'left', w: nh },
    { kind: 'right', w: [-nh[0], -nh[1], 0] },
  ];
  for (const { kind, w } of dirs) {
    const r = scan(c, S, dn, L, w);
    if (!r) continue;
    let len = 0;
    for (let i = 1; i < r.hull.length; i++)
      len += Math.hypot(r.hull[i]![0] - r.hull[i - 1]![0], r.hull[i]![1] - r.hull[i - 1]![1]);
    const edges = r.hull.length - 2;
    const delta = len - L;
    if (edges < 1 || !(delta > 1e-9)) continue;
    const first = r.hull[1]!,
      last = r.hull[r.hull.length - 2]!;
    out.push({
      kind,
      delta,
      edges,
      edgeSpan: Math.hypot(last[0] - first[0], last[1] - first[1]),
      points: r.hull.map((p) => r.frame(p[0], p[1])),
    });
  }
  return out;
}

export interface DiffractionResult {
  gain: PerBand<number>; // 밴드별 회절음 상대 에너지 이득
  paths: DiffractionPath[]; // 사용한 우회 경로
}

/**
 * 직선이 가려진 수음점의 회절음 이득. 경로별 Dz를 밴드별로 구해 에너지 합산한다 (근사, 경험식).
 * 거리 감쇠는 직선 거리 기준이며 우회 효과는 Dz가 반영한다 (ISO 9613-2 방식).
 */
export function diffractionGains(
  c: CompiledScene,
  S: Vec3,
  R: Vec3,
  speed: number, // 음속 [m/s]
  alpha: PerBand<number>, // 공기 흡음 [dB/m]
): DiffractionResult {
  const paths = findDiffractionPaths(c, S, R);
  const d = Math.hypot(R[0] - S[0], R[1] - S[1], R[2] - S[2]);
  const gain = perBand((fc) => {
    const lambda = speed / fc;
    let sum = 0; // 포화되지 않은 경로의 에너지 합
    let best = Infinity; // 모든 경로가 포화일 때 쓸 최소 감쇠 [dB]
    for (const p of paths) {
      const raw = rawDz(p.delta, lambda, p.edges, p.edgeSpan);
      const cap = p.edges >= 2 ? DZ_CAP_DOUBLE : DZ_CAP_SINGLE;
      if (raw <= cap) sum += Math.pow(10, -raw / 10);
      best = Math.min(best, Math.min(raw, cap));
    }
    // 상한에 걸린 경로는 포화된 것이므로 합산하지 않는다. 모두 포화면 가장 덜 감쇠되는 경로 하나만 쓴다.
    if (sum === 0 && paths.length > 0) sum = Math.pow(10, -best / 10);
    return sum * spreadingGain(d, alpha[fc]);
  });
  return { gain, paths };
}
