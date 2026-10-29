/** 좌표 [x, y, z]. 단위 m, Z-up 우수 좌표계 (Rhino와 동일). */
export type Vec3 = readonly [number, number, number];

/** 입력 경계에서만 쓰는 길이 단위. 솔버 내부는 항상 m. */
export type LengthUnit = 'mm' | 'cm' | 'm';

/** 1/1 옥타브 밴드 중심 주파수 [Hz]. 물리 문서 2장 참조. */
export const BAND_CENTERS = [125, 250, 500, 1000, 2000, 4000] as const;
export type BandCenter = (typeof BAND_CENTERS)[number];

/** 밴드별 값 (모든 밴드를 반드시 가진다). */
export type PerBand<T> = Readonly<Record<BandCenter, T>>;
