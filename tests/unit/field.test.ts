import { describe, expect, it } from 'vitest';
import { barrierScene, boxRoomScene, freeFieldScene } from '../../src/data/examples';
import { NO_AIR_ABSORPTION } from '../../src/solver/core/airAbsorption';
import { flatBands } from '../../src/solver/core/bands';
import { compileScene } from '../../src/solver/core/compile';
import { relativeLevelDb } from '../../src/solver/physics/direct';
import { evaluateField, makeFieldContext, type FieldOptions } from '../../src/solver/physics/field';
import type { Vec3 } from '../../src/types';

const lw = flatBands(94);
const opt = (o: Partial<FieldOptions> = {}): FieldOptions => ({
  direct: true,
  maxOrder: 2,
  diffraction: true,
  ...o,
});
const level = (
  g: ReturnType<typeof evaluateField>['total'],
  sel: Parameters<typeof relativeLevelDb>[2] = 1000,
) => relativeLevelDb(g, lw, sel);

describe('수신점 합성 (직접 + 반사 + 회절)', () => {
  it('자유장: 반사·회절 없이 직접음 = −20log10 r', () => {
    const c = compileScene(freeFieldScene);
    const ctx = makeFieldContext(c, [0, 0, 0], lw, NO_AIR_ABSORPTION, 343, opt());
    const f = evaluateField(ctx, [4, 0, 0]);
    expect(f.nReflectionPaths).toBe(0);
    expect(level(f.total)).toBeCloseTo(-20 * Math.log10(4), 6);
  });

  it('박스룸: 반사가 더해지면 레벨이 직접음보다 커지고, 성분 합 = 전체', () => {
    const c = compileScene(boxRoomScene);
    const src: Vec3 = [3, 3, 3],
      rcv: Vec3 = [8, 7, 5];
    const direct = evaluateField(
      makeFieldContext(c, src, lw, NO_AIR_ABSORPTION, 343, opt({ maxOrder: 0 })),
      rcv,
    );
    const full = evaluateField(makeFieldContext(c, src, lw, NO_AIR_ABSORPTION, 343, opt()), rcv);
    expect(full.nReflectionPaths).toBe(24); // 1차 6 + 2차 18 (인접 벽은 한 순서만 유효)
    expect(level(full.total)).toBeGreaterThan(level(direct.total));
    expect(full.total[1000]).toBeCloseTo(full.direct[1000] + full.reflection[1000], 12);
  });

  it('차폐벽 뒤: 직접음 가려짐, 회절 포함 시 4 kHz에서 자유장 대비 −25 dB (두께 0.4 m 벽 = 이중 회절 상한)', () => {
    const c = compileScene(barrierScene);
    const src: Vec3 = [5, 0, 1.5],
      rcv: Vec3 = [25, 0, 1.5];
    const f = evaluateField(makeFieldContext(c, src, lw, NO_AIR_ABSORPTION, 343, opt()), rcv);
    expect(f.visible).toBe(false);
    expect(f.nReflectionPaths).toBe(0); // 벽이 반사 경로도 가림
    expect(level(f.total, 4000)).toBeCloseTo(-20 * Math.log10(20) - 25, 1);
    const off = evaluateField(
      makeFieldContext(c, src, lw, NO_AIR_ABSORPTION, 343, opt({ diffraction: false })),
      rcv,
    );
    expect(level(off.total, 4000)).toBe(-Infinity);
  });

  it('저주파일수록 회절 감쇠가 작다 (125 Hz 레벨 > 4 kHz 레벨)', () => {
    const c = compileScene(barrierScene);
    const f = evaluateField(
      makeFieldContext(c, [5, 0, 1.5], lw, NO_AIR_ABSORPTION, 343, opt()),
      [25, 0, 1.5],
    );
    expect(level(f.total, 125)).toBeGreaterThan(level(f.total, 4000));
  });
});
