import { describe, expect, it } from 'vitest';
import { makeDomain } from '../../src/geometry/domain';
import { flatBands } from '../../src/solver/core/bands';
import { compileScene } from '../../src/solver/core/compile';
import { OPEN_BOUNDARY_MATERIAL } from '../../src/data/materials';
import { diffuseAtPoint, diffuseAtReceiver } from '../../src/solver/physics/diffuse';
import {
  DEFAULT_FIELD_OPTIONS,
  evaluateField,
  makeFieldContext,
} from '../../src/solver/physics/field';
import {
  cosineSample,
  DEFAULT_DIFFUSE,
  traceDiffuse,
  uniformSphere,
  type DiffuseSettings,
} from '../../src/solver/tracing/diffuseTrace';
import { mulberry32 } from '../../src/visualization/wavefrontModel';
import { SCENE_SCHEMA_VERSION, type Material, type Scene, type Vec3 } from '../../src/types';

const room = (a: number, s: number, size = 10): Scene => {
  const mat: Material = {
    id: 'm',
    name: 'm',
    absorption: flatBands(a),
    scattering: flatBands(s),
    isExample: true,
  };
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    name: 'room',
    units: 'm',
    domain: makeDomain([size, size, size], { type: 'reflect', materialId: 'm' }),
    meshes: [],
    materials: [mat, OPEN_BOUNDARY_MATERIAL],
    sources: [],
    receivers: [],
  };
};
const free = (): Scene => ({
  ...room(1, 0, 40),
  domain: makeDomain(
    [40, 40, 40],
    { type: 'open', materialId: OPEN_BOUNDARY_MATERIAL.id },
    [-20, -20, -20],
  ),
});
const NO_AIR = flatBands(0);
const S = (p: Vec3) => ({
  kind: 'point' as const,
  id: 's',
  name: 's',
  position: p,
  lw: flatBands(94),
});
const R = (p: Vec3, radius = 0.5) => ({ id: 'r', name: 'r', position: p, radius });
const cfg = (o: Partial<DiffuseSettings>): DiffuseSettings => ({ ...DEFAULT_DIFFUSE, ...o });

describe('샘플러', () => {
  it('코사인 샘플: 반구 안, E[cosθ] = 2/3, P(cosθ ≥ 0.5) = 0.75', () => {
    const rnd = mulberry32(1);
    const n: Vec3 = [0.6, 0, 0.8];
    let sum = 0;
    let hi = 0;
    const N = 40000;
    for (let i = 0; i < N; i++) {
      const d = cosineSample(n, rnd(), rnd());
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 9);
      const cs = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      expect(cs).toBeGreaterThanOrEqual(-1e-12);
      sum += cs;
      if (cs >= 0.5) hi++;
    }
    expect(sum / N).toBeGreaterThan(0.655);
    expect(sum / N).toBeLessThan(0.678);
    expect(hi / N).toBeGreaterThan(0.735);
    expect(hi / N).toBeLessThan(0.765);
  });
  it('균일 구면: 평균 방향 ≈ 0, 단위 벡터', () => {
    const rnd = mulberry32(2);
    const m = [0, 0, 0];
    for (let i = 0; i < 20000; i++) {
      const d = uniformSphere(rnd(), rnd());
      expect(Math.hypot(...d)).toBeCloseTo(1, 9);
      for (let a = 0; a < 3; a++) m[a] += d[a]! / 20000;
    }
    for (const v of m) expect(Math.abs(v)).toBeLessThan(0.02);
  });
});

describe('수신 구 추정자', { timeout: 60000 }, () => {
  it('자유장: 직접음 포함 시 이득 = (1 m / r)²', () => {
    const c = compileScene(free());
    const r = traceDiffuse({
      c,
      sources: [S([0, 0, 0])],
      receivers: [R([5, 0, 0])],
      alpha: NO_AIR,
      speed: 343,
      countFrom: [0],
      settings: cfg({ raysPerBand: 160000 }),
    });
    const g = diffuseAtReceiver(r, 0, 0)[1000];
    expect(Math.abs(g - 0.04) / 0.04).toBeLessThan(0.05);
  });
  it('자유장 + 공기 흡음: 이득에 10^(-α r/10)가 곱해짐', () => {
    const c = compileScene(free());
    const a = flatBands(0.5); // [dB/m]
    const r = traceDiffuse({
      c,
      sources: [S([0, 0, 0])],
      receivers: [R([5, 0, 0])],
      alpha: a,
      speed: 343,
      countFrom: [0],
      settings: cfg({ raysPerBand: 160000 }),
    });
    const expected = 0.04 * Math.pow(10, -(0.5 * 5) / 10);
    expect(Math.abs(diffuseAtReceiver(r, 0, 0)[1000] - expected) / expected).toBeLessThan(0.06);
  });
  it('같은 시드 → 같은 결과, 다른 시드 → 다른 결과', () => {
    const c = compileScene(room(0.2, 0.5));
    const run = (seed: number) =>
      traceDiffuse({
        c,
        sources: [S([3, 3, 3])],
        receivers: [R([7, 6, 4])],
        alpha: NO_AIR,
        speed: 343,
        countFrom: [3],
        settings: cfg({ raysPerBand: 2000, seed }),
      });
    const a = run(5).rcv;
    const b = run(5).rcv;
    const d = run(6).rcv;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(d));
  });
});

describe('에너지 보존', () => {
  it('흡수 + 공기 + 잔여 = 방출 에너지 (s = 0.5, 공기 흡음 있음)', () => {
    const c = compileScene(room(0.2, 0.5));
    const r = traceDiffuse({
      c,
      sources: [S([3, 3, 3])],
      receivers: [R([7, 6, 4])],
      alpha: flatBands(0.02),
      speed: 343,
      countFrom: [3],
      settings: cfg({ raysPerBand: 4000 }),
    });
    for (const b of r.balance) expect(b.absorbed + b.air + b.residual).toBeCloseTo(1, 9);
  });
});

describe('확산장 참조해', { timeout: 60000 }, () => {
  it('s = 1 닫힌 방 (α = 0.2, 10 m 정육면체): 이득 ≈ 16π(1−α)/(Sα) [참조: 평균 자유 행로 4V/S]', () => {
    const c = compileScene(room(0.2, 1));
    const rcvs = [R([5, 5, 5], 1), R([3, 6, 4], 1), R([7, 3, 6], 1)];
    const r = traceDiffuse({
      c,
      sources: [S([3, 3, 3])],
      receivers: rcvs,
      alpha: NO_AIR,
      speed: 343,
      countFrom: [99], // 확산 반사 이후만 집계
      onlyBands: [2], // 500 Hz만
      settings: cfg({ raysPerBand: 80000, maxBounces: 200 }),
    });
    const expected = (16 * Math.PI * (1 - 0.2)) / (600 * 0.2);
    const mean = rcvs.reduce((a, _, i) => a + diffuseAtReceiver(r, 0, i)[500], 0) / rcvs.length;
    expect(Math.abs(mean - expected) / expected).toBeLessThan(0.08);
    // 복셀(슬라이스)도 같은 크기
    expect(Math.abs(diffuseAtPoint(r, 0, [5, 5, 5])[500] - expected) / expected).toBeLessThan(0.1);
  });
});

describe('이중 집계 방지 (s = 0이면 STEP 2와 일치)', { timeout: 60000 }, () => {
  const scene = room(0.2, 0);
  const c = compileScene(scene);
  const src: Vec3 = [3, 3, 3];
  const rcv: Vec3 = [7, 6, 4];
  const base = {
    c,
    sources: [S(src)],
    receivers: [R(rcv)],
    alpha: NO_AIR,
    speed: 343,
    onlyBands: [3],
  } as const;
  const set = cfg({ raysPerBand: 400000, maxBounces: 4 }); // 0~4차 경로만 (이미지 음원도 4차까지)
  const det = (order: number) =>
    evaluateField(
      makeFieldContext(c, src, flatBands(94), NO_AIR, 343, {
        ...DEFAULT_FIELD_OPTIONS,
        maxOrder: order,
        diffraction: false,
      }),
      rcv,
    ).total[1000];
  const mc = (from: number) =>
    diffuseAtReceiver(traceDiffuse({ ...base, countFrom: [from], settings: set }), 0, 0)[1000];
  it('MC 수신 구 추정자 ≈ 이미지 음원 (0~4차 전체, s = 0)', () => {
    expect(Math.abs(mc(0) - det(4)) / det(4)).toBeLessThan(0.05);
  });
  it('이미지 음원(≤2차) + MC(≥3차) = 전체: 이중 집계도 누락도 없음', () => {
    expect(Math.abs(det(2) + mc(3) - det(4)) / det(4)).toBeLessThan(0.05);
  });
});
