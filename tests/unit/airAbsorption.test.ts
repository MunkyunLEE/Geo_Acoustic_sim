import { describe, expect, it } from 'vitest';
import { airAbsorptionDbPerM, speedOfSound } from '../../src/solver/core/airAbsorption';

// ISO 9613-2 Table 2 (OCR 추출본) 참조값 [dB/km], 20 °C 70 %: 125,250,500,1k,2k,4k Hz
describe('airAbsorption', () => {
  it('ISO 9613-2 Table 2 (20 °C, 70 %) 와 일치 (표 반올림 ±0.1 dB/km 또는 5%)', () => {
    const air = { temperatureC: 20, relativeHumidityPct: 70, pressureKPa: 101.325 };
    const ref: [number, number][] = [
      [125, 0.3],
      [250, 1.1],
      [500, 2.8],
      [1000, 5.0],
      [2000, 9.0],
      [4000, 22.9],
    ];
    for (const [f, dbkm] of ref) {
      const v = airAbsorptionDbPerM(f, air) * 1000;
      expect(Math.abs(v - dbkm)).toBeLessThan(Math.max(0.1, 0.05 * dbkm) + 1e-9);
    }
  });
  it('음속 20 °C ≈ 343 m/s', () => {
    expect(speedOfSound(20)).toBeGreaterThan(342.5);
    expect(speedOfSound(20)).toBeLessThan(344);
  });
});
