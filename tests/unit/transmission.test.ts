import { describe, expect, it } from 'vitest';
import { makeDomain } from '../../src/geometry/domain';
import { OPEN_BOUNDARY_MATERIAL } from '../../src/data/materials';
import { flatBands } from '../../src/solver/core/bands';
import { compileScene, specularFactor } from '../../src/solver/core/compile';
import { hasErrors, validateScene } from '../../src/solver/core/validation';
import { diffuseAtReceiver } from '../../src/solver/physics/diffuse';
import {
  DEFAULT_FIELD_OPTIONS,
  evaluateField,
  makeFieldContext,
} from '../../src/solver/physics/field';
import {
  DEFAULT_DIFFUSE,
  traceDiffuse,
  type DiffuseSettings,
} from '../../src/solver/tracing/diffuseTrace';
import {
  SCENE_SCHEMA_VERSION,
  type Material,
  type MeshSurface,
  type Scene,
  type Vec3,
} from '../../src/types';

const mat = (id: string, a: number, s: number, t: number): Material => ({
  id,
  name: id,
  absorption: flatBands(a),
  scattering: flatBands(s),
  transmission: flatBands(t),
  isExample: true,
});
/** x = xp 평면 (y, z 방향 half 크기). 두 삼각형. */
const plane = (id: string, xp: number, half: number, materialId: string): MeshSurface => ({
  id,
  name: id,
  positions: Float32Array.from([
    xp,
    -half,
    -half,
    xp,
    half,
    -half,
    xp,
    half,
    half,
    xp,
    -half,
    half,
  ]),
  indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  materialId,
});
const freeScene = (meshes: MeshSurface[], mats: Material[]): Scene => ({
  schemaVersion: SCENE_SCHEMA_VERSION,
  name: 't',
  units: 'm',
  domain: makeDomain(
    [60, 60, 60],
    { type: 'open', materialId: OPEN_BOUNDARY_MATERIAL.id },
    [-30, -30, -30],
  ),
  meshes,
  materials: [...mats, OPEN_BOUNDARY_MATERIAL],
  sources: [],
  receivers: [],
});
const S = (p: Vec3) => ({
  kind: 'point' as const,
  id: 's',
  name: 's',
  position: p,
  lw: flatBands(94),
});
const R = (p: Vec3, radius = 0.5) => ({ id: 'r', name: 'r', position: p, radius });
const cfg = (o: Partial<DiffuseSettings>): DiffuseSettings => ({ ...DEFAULT_DIFFUSE, ...o });
const NO_AIR = flatBands(0);

describe('투과 (STEP 6)', () => {
  it('정반사 계수 = (1 − α − τ)(1 − s)', () => {
    expect(specularFactor(mat('m', 0.2, 0.25, 0.3))[1000]).toBeCloseTo(0.5 * 0.75, 12);
  });
  it('투과율이 없는 재료는 이전과 같다 (transmission 생략)', () => {
    const m: Material = { ...mat('m', 0.2, 0.25, 0), transmission: undefined };
    expect(specularFactor(m)[500]).toBeCloseTo(0.8 * 0.75, 12);
  });
  it('α + τ > 1이면 검증 오류', () => {
    const sc = freeScene([plane('p', 2, 3, 'm')], [mat('m', 0.7, 0, 0.6)]);
    expect(hasErrors(validateScene(sc))).toBe(true);
  });
  it('직접음: 면 하나 통과 → τ, 둘 통과 → τ²', () => {
    const sc = freeScene([plane('p1', 2, 5, 'm'), plane('p2', 3, 5, 'm')], [mat('m', 0.3, 0, 0.1)]);
    const c = compileScene(sc);
    const opt = { ...DEFAULT_FIELD_OPTIONS, maxOrder: 0, diffraction: false };
    const at = (x: number) =>
      evaluateField(makeFieldContext(c, [0, 0, 0], flatBands(94), NO_AIR, 343, opt), [x, 0, 0])
        .direct[1000] *
      x *
      x;
    expect(at(1.5)).toBeCloseTo(1, 9); // 면 앞 (가림 없음)
    expect(at(2.5)).toBeCloseTo(0.1, 6);
    expect(at(4)).toBeCloseTo(0.01, 6);
  });
  it('투과가 0이면 직접음은 완전 차폐 (이전 동작)', () => {
    const sc = freeScene([plane('p', 2, 5, 'm')], [mat('m', 0.3, 0, 0)]);
    const c = compileScene(sc);
    const opt = { ...DEFAULT_FIELD_OPTIONS, maxOrder: 0, diffraction: false };
    const f = evaluateField(
      makeFieldContext(c, [0, 0, 0], flatBands(94), NO_AIR, 343, opt),
      [4, 0, 0],
    );
    expect(f.direct[1000]).toBe(0);
  });
});

describe('투과 몬테카를로', { timeout: 60000 }, () => {
  const run = (from: number, mats: Material[], meshes: MeshSurface[], rcv: Vec3) =>
    traceDiffuse({
      c: compileScene(freeScene(meshes, mats)),
      sources: [S([0, 0, 0])],
      receivers: [R(rcv)],
      alpha: NO_AIR,
      speed: 343,
      countFrom: [from],
      onlyBands: [3],
      settings: cfg({ raysPerBand: 200000, maxBounces: 10 }),
    });
  it('α + τ = 1인 면: 뒤쪽 이득 = τ/r² (직접 투과도 MC가 세도록 countFrom=0)', () => {
    const r = run(0, [mat('m', 0.5, 0, 0.5)], [plane('p', 2, 8, 'm')], [5, 0, 0]);
    const g = diffuseAtReceiver(r, 0, 0)[1000];
    expect(Math.abs(g - 0.5 / 25) / (0.5 / 25)).toBeLessThan(0.06);
  });
  it('이중 집계 방지: 반사 없는 투과 경로(직접 투과)는 기본 규칙에서 MC가 세지 않는다', () => {
    const r = run(1, [mat('m', 0.5, 0, 0.5)], [plane('p', 2, 8, 'm')], [5, 0, 0]);
    expect(diffuseAtReceiver(r, 0, 0)[1000]).toBe(0);
  });
  it('에너지 보존 (투과 + 확산 + 흡수)', () => {
    const r = run(1, [mat('m', 0.2, 0.5, 0.3)], [plane('p', 2, 8, 'm')], [5, 0, 0]);
    for (const b of r.balance) expect(b.absorbed + b.air + b.residual).toBeCloseTo(1, 9);
  });
});

describe('에코그램·표면 입사 (STEP 5)', { timeout: 60000 }, () => {
  it('에코그램 구간의 합 = 수신 구 이득, 직접음 도달 시간 ≈ r/c', () => {
    const c = compileScene(freeScene([], []));
    const r = traceDiffuse({
      c,
      sources: [S([0, 0, 0])],
      receivers: [R([6.86, 0, 0])],
      alpha: NO_AIR,
      speed: 343,
      countFrom: [0],
      onlyBands: [3],
      settings: cfg({ raysPerBand: 300000, echoDtMs: 2, echoMaxMs: 100 }),
    });
    const bins = Array.from(r.echo.subarray(3 * r.echoBins, 4 * r.echoBins));
    const sum = bins.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(diffuseAtReceiver(r, 0, 0)[1000], 5);
    const peak = bins.indexOf(Math.max(...bins));
    expect(Math.abs(peak - Math.round(6.86 / 343 / 0.002))).toBeLessThanOrEqual(1);
  });
  it('표면 입사: 5 m 앞 1×1 m 면의 입사 이득 ≈ 1/r²', () => {
    const c = compileScene(freeScene([plane('p', 5, 0.5, 'm')], [mat('m', 1, 0, 0)]));
    const r = traceDiffuse({
      c,
      sources: [S([0, 0, 0])],
      receivers: [],
      alpha: NO_AIR,
      speed: 343,
      countFrom: [0],
      onlyBands: [3],
      settings: cfg({ raysPerBand: 800000 }),
    });
    const tri0 = 12; // 영역 면 12개 삼각형 뒤가 객체
    for (const t of [tri0, tri0 + 1]) {
      const g = r.surf[3 * r.nTri + t]!;
      expect(Math.abs(g - 1 / 25) / (1 / 25)).toBeLessThan(0.12);
    }
  });
});
