import { describe, expect, it } from 'vitest';
import { buildBvh, closestHit, bruteForceClosest, anyHit } from '../../src/solver/tracing/bvh';
import { makeBoxMesh } from '../../src/geometry/primitives';
import { computeDirect, relativeLevelDb, spreadingGain } from '../../src/solver/physics/direct';
import { NO_AIR_ABSORPTION } from '../../src/solver/core/airAbsorption';
import { flatBands } from '../../src/solver/core/bands';
import { computeSlice } from '../../src/solver/receivers/slice';
import { freeFieldScene } from '../../src/data/examples';
import { compileScene } from '../../src/solver/core/compile';
import { DEFAULT_FIELD_OPTIONS, makeFieldContext } from '../../src/solver/physics/field';
import type { Vec3 } from '../../src/types';

const lw = flatBands(94);

describe('direct sound', () => {
  it('거리 2배 → -6.0206 dB (공기 흡음 끔)', () => {
    const a = relativeLevelDb(
      computeDirect([0, 0, 0], [1, 0, 0], null, NO_AIR_ABSORPTION).gain,
      lw,
      'total',
    );
    const b = relativeLevelDb(
      computeDirect([0, 0, 0], [2, 0, 0], null, NO_AIR_ABSORPTION).gain,
      lw,
      'total',
    );
    expect(a).toBeCloseTo(0, 6);
    expect(b - a).toBeCloseTo(-6.0206, 3);
  });
  it('음원 위치에서도 NaN/Infinity 없음', () => {
    const g = spreadingGain(0, 0);
    expect(Number.isFinite(g)).toBe(true);
  });
  it('가려지면 직접음 0, 보이면 > 0', () => {
    const wall = makeBoxMesh('wall', 'wall', [4.9, -5, -5], [5.1, 5, 5], 'm');
    const bvh = buildBvh([wall]);
    const blocked = computeDirect([0, 0, 0], [8, 0, 0], bvh, NO_AIR_ABSORPTION);
    const open = computeDirect([0, 0, 0], [0, 8, 0], bvh, NO_AIR_ABSORPTION);
    expect(blocked.visible).toBe(false);
    expect(relativeLevelDb(blocked.gain, lw, 'total')).toBe(-Infinity);
    expect(open.visible).toBe(true);
  });
  it('밴드 합산은 선형 평균', () => {
    const gain = { 125: 1, 250: 0.5, 500: 0.25, 1000: 0.25, 2000: 0, 4000: 0 };
    expect(relativeLevelDb(gain, lw, 'total')).toBeCloseTo(10 * Math.log10(2 / 6), 6);
  });
});

describe('BVH', () => {
  it('무작위 레이 500개가 완전 탐색과 일치', () => {
    const meshes = [];
    let s = 12345; // 고정 시드 LCG
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 40; i++) {
      const c: Vec3 = [rnd() * 20, rnd() * 20, rnd() * 20];
      meshes.push(
        makeBoxMesh(
          `b${i}`,
          `b${i}`,
          c,
          [c[0] + 1 + rnd(), c[1] + 1 + rnd(), c[2] + 1 + rnd()],
          'm',
        ),
      );
    }
    const bvh = buildBvh(meshes);
    for (let k = 0; k < 500; k++) {
      const o: Vec3 = [rnd() * 20, rnd() * 20, rnd() * 20];
      const d: Vec3 = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
      const l = Math.hypot(...d);
      const dn: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
      const a = closestHit(bvh, o, dn, 1e-9, 1e9);
      const b = bruteForceClosest(bvh, o, dn, 1e-9, 1e9);
      expect(a === null).toBe(b === null);
      if (a && b) expect(a.t).toBeCloseTo(b.t, 9);
      expect(anyHit(bvh, o, dn, 1e-9, 1e9)).toBe(b !== null);
    }
  });
});

describe('slice', () => {
  it('자유장(전 면 소산)에서 해석해 −20log10(r)과 일치', () => {
    const c = compileScene(freeFieldScene);
    const ctx = makeFieldContext(c, [0, 0, 0], lw, NO_AIR_ABSORPTION, 343, DEFAULT_FIELD_OPTIONS);
    const g = computeSlice({
      min: [-5, -5, 0],
      max: [5, 5, 0],
      z: 1,
      ctx,
      sel: 'total',
      maxCells: 20,
    });
    const i = 15,
      j = 7;
    const x = g.x0 + (i + 0.5) * g.cell,
      y = g.y0 + (j + 0.5) * g.cell;
    const r = Math.hypot(x, y, 1);
    expect(g.levels[j * g.nx + i]).toBeCloseTo(-20 * Math.log10(r), 4);
  });
});
