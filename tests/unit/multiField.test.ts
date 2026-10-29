import { describe, expect, it } from 'vitest';
import { freeFieldScene } from '../../src/data/examples';
import { NO_AIR_ABSORPTION } from '../../src/solver/core/airAbsorption';
import { flatBands } from '../../src/solver/core/bands';
import { compileScene } from '../../src/solver/core/compile';
import { DEFAULT_FIELD_OPTIONS } from '../../src/solver/physics/field';
import { evaluateMulti, levelAt, makeMultiField } from '../../src/solver/physics/multiField';
import type { PointSource } from '../../src/types';

const src = (id: string, x: number, lw: number): PointSource => ({
  kind: 'point',
  id,
  name: id,
  position: [x, 0, 0],
  lw: flatBands(lw),
});
const c = compileScene(freeFieldScene);
const mk = (s: PointSource[]) =>
  makeMultiField(c, s, NO_AIR_ABSORPTION, 343, DEFAULT_FIELD_OPTIONS, 'total');

describe('다중 음원', () => {
  it('음원 1개: 자유장 −20log10 r', () => {
    const r = evaluateMulti(mk([src('a', 0, 94)]), [4, 0, 0]);
    expect(r.totalDb).toBeCloseTo(-20 * Math.log10(4), 4);
  });
  it('같은 Lw 두 음원이 같은 거리 → +3.0103 dB', () => {
    const one = evaluateMulti(mk([src('a', -3, 94)]), [0, 5, 0]).totalDb;
    const two = evaluateMulti(mk([src('a', -3, 94), src('b', 3, 94)]), [0, 5, 0]).totalDb;
    expect(two - one).toBeCloseTo(3.0103, 3);
  });
  it('Lw가 10 dB 낮은 음원은 에너지 비율 0.1로 합산 (기준 = 큰 음원)', () => {
    const base = evaluateMulti(mk([src('a', -3, 94)]), [0, 5, 0]).totalDb;
    const both = evaluateMulti(mk([src('a', -3, 94), src('b', 3, 84)]), [0, 5, 0]).totalDb;
    expect(both - base).toBeCloseTo(10 * Math.log10(1.1), 3);
  });
  it('levelAt = evaluateMulti.totalDb', () => {
    const mf = mk([src('a', -3, 94), src('b', 3, 90)]);
    expect(levelAt(mf, [1, 2, 3])).toBeCloseTo(evaluateMulti(mf, [1, 2, 3]).totalDb, 8);
  });
  it('가장 가까운 음원까지의 거리를 돌려준다', () => {
    expect(evaluateMulti(mk([src('a', -3, 94), src('b', 6, 94)]), [4, 0, 0]).distance).toBeCloseTo(
      2,
      8,
    );
  });
});
