import { describe, expect, it } from 'vitest';
import { A_WEIGHTING_DB, bandEdges, flatBands, perBand } from '../../src/solver/core/bands';
import { BAND_CENTERS } from '../../src/types';

describe('옥타브 밴드', () => {
  it('중심 주파수는 125~4000 Hz 6개', () => {
    expect(BAND_CENTERS).toEqual([125, 250, 500, 1000, 2000, 4000]);
  });

  it('밴드 경계는 fc/√2 ~ fc·√2 이고 인접 밴드가 맞닿는다', () => {
    expect(bandEdges(1000).lo).toBeCloseTo(707.107, 3);
    expect(bandEdges(1000).hi).toBeCloseTo(1414.214, 3);
    for (let i = 0; i < BAND_CENTERS.length - 1; i++) {
      const a = BAND_CENTERS[i] as (typeof BAND_CENTERS)[number];
      const b = BAND_CENTERS[i + 1] as (typeof BAND_CENTERS)[number];
      expect(bandEdges(a).hi).toBeCloseTo(bandEdges(b).lo, 9);
    }
  });

  it('perBand와 flatBands는 모든 밴드를 채운다', () => {
    expect(Object.keys(flatBands(0.5))).toHaveLength(6);
    expect(perBand((fc) => fc * 2)[250]).toBe(500);
  });

  it('A 가중은 1 kHz에서 0 dB', () => {
    expect(A_WEIGHTING_DB[1000]).toBe(0);
  });
});
