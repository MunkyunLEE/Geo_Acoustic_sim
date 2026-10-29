import { describe, expect, it } from 'vitest';
import { dbToPower, lwToWatts, powerToDb, sumLevelsDb, wattsToLw } from '../../src/solver/core/db';

describe('dB 변환', () => {
  it('1 pW는 Lw = 0 dB, 1 W는 120 dB', () => {
    expect(wattsToLw(1e-12)).toBeCloseTo(0, 10);
    expect(wattsToLw(1)).toBeCloseTo(120, 10);
  });

  it('Lw ↔ W 왕복 변환이 일치한다', () => {
    for (const lw of [-10, 0, 63.5, 94, 120]) expect(wattsToLw(lwToWatts(lw))).toBeCloseTo(lw, 9);
  });

  it('같은 레벨 두 개의 에너지 합은 +3.0103 dB', () => {
    expect(sumLevelsDb([80, 80])).toBeCloseTo(80 + 10 * Math.log10(2), 10);
  });

  it('레벨 합산은 dB 값을 직접 더하지 않는다', () => {
    expect(sumLevelsDb([80, 80])).not.toBeCloseTo(160, 1);
    expect(sumLevelsDb([90, 70])).toBeCloseTo(90.0432, 3);
  });

  it('0 이하 에너지와 빈 입력은 -Infinity이며 NaN이 아니다', () => {
    expect(powerToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(sumLevelsDb([])).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(dbToPower(Number.NEGATIVE_INFINITY))).toBe(false);
  });
});
