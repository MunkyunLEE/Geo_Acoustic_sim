import { describe, expect, it } from 'vitest';
import { convertPositionsToMeters, toMeters } from '../../src/solver/core/units';

describe('길이 단위 변환', () => {
  it('mm, cm, m → m', () => {
    expect(toMeters(1500, 'mm')).toBeCloseTo(1.5, 12);
    expect(toMeters(250, 'cm')).toBeCloseTo(2.5, 12);
    expect(toMeters(3, 'm')).toBe(3);
  });

  it('좌표 배열을 변환하고 원본은 바꾸지 않는다', () => {
    const src = [1000, 2000, 3000];
    const out = convertPositionsToMeters(src, 'mm');
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(src).toEqual([1000, 2000, 3000]);
  });
});
