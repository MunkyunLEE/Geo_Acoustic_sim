/** viridis 근사 (9개 정지점). t=0 어두운 보라, t=1 노랑. 표시 전용. */
const STOPS: readonly (readonly [number, number, number])[] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [132, 212, 75],
  [253, 231, 37],
];

/** t ∈ [0,1] → RGB (0~255). 범위 밖 값은 끝값으로 고정한다. */
export function colormap(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** 상대 레벨 [dB] → t. maxDb(보통 0)이 1, minDb(예: -60)이 0. */
export function levelToT(db: number, minDb: number, maxDb = 0): number {
  if (!Number.isFinite(db)) return 0;
  return (db - minDb) / (maxDb - minDb);
}

/** 컬러바용 CSS linear-gradient 문자열 (위가 높은 레벨). */
export function cssGradient(direction = 'to top'): string {
  const parts = STOPS.map(
    (s, i) => `rgb(${s[0]},${s[1]},${s[2]}) ${(i / (STOPS.length - 1)) * 100}%`,
  );
  return `linear-gradient(${direction}, ${parts.join(', ')})`;
}
