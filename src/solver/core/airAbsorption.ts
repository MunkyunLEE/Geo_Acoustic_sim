import { BAND_CENTERS, type PerBand } from '../../types';
import { perBand } from './bands';

/** 대기 조건. 물리 문서 5장. */
export interface AirConditions {
  temperatureC: number; // 온도 [°C]
  relativeHumidityPct: number; // 상대습도 [%]
  pressureKPa: number; // 기압 [kPa]
}

/** 기본 가정: 20 °C, 상대습도 50 %, 101.325 kPa. */
export const DEFAULT_AIR: AirConditions = {
  temperatureC: 20,
  relativeHumidityPct: 50,
  pressureKPa: 101.325,
};

/** 음속 [m/s]. c ≈ 331.3 √(1 + T/273.15) (근사식). */
export function speedOfSound(temperatureC: number): number {
  return 331.3 * Math.sqrt(1 + temperatureC / 273.15);
}

/**
 * 순음의 공기 흡음 계수 α [dB/m] (ISO 9613-1).
 * 검증: ISO 9613-2:1996 Table 2 (6개 조건, 63~8000 Hz)와 대조 (tests/unit/airAbsorption.test.ts).
 */
export function airAbsorptionDbPerM(
  freqHz: number, // 주파수 [Hz]
  air: AirConditions, // 대기 조건
): number {
  const T = air.temperatureC + 273.15; // 절대온도 [K]
  const T0 = 293.15; // 기준 온도 [K]
  const T01 = 273.16; // 삼중점 온도 [K]
  const pr = 101.325; // 기준 기압 [kPa]
  const pa = air.pressureKPa;
  const C = -6.8346 * Math.pow(T01 / T, 1.261) + 4.6151;
  const h = (air.relativeHumidityPct * Math.pow(10, C)) / (pa / pr); // 수증기 몰 농도 [%]
  const frO = (pa / pr) * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h)); // 산소 이완 주파수
  const frN =
    (pa / pr) *
    Math.pow(T / T0, -0.5) *
    (9 + 280 * h * Math.exp(-4.17 * (Math.pow(T / T0, -1 / 3) - 1))); // 질소 이완 주파수
  const f2 = freqHz * freqHz;
  return (
    8.686 *
    f2 *
    (1.84e-11 * (pr / pa) * Math.sqrt(T / T0) +
      Math.pow(T / T0, -2.5) *
        ((0.01275 * Math.exp(-2239.1 / T)) / (frO + f2 / frO) +
          (0.1068 * Math.exp(-3352.0 / T)) / (frN + f2 / frN)))
  );
}

/** 밴드 중심 주파수에서의 α [dB/m]. 옥타브 밴드 대표값 (근사). */
export function airAbsorptionPerBand(air: AirConditions): PerBand<number> {
  return perBand((fc) => airAbsorptionDbPerM(fc, air));
}

/** 공기 흡음을 끈 상태 (모든 밴드 0). */
export const NO_AIR_ABSORPTION: PerBand<number> = perBand(() => 0);

export { BAND_CENTERS };
