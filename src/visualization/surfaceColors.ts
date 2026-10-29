import { colormap, levelToT } from './colormap';

/** 삼각형별 입사 레벨 [dB] → 삼각형별 RGB (0~1, 삼각형당 3개). 컬러맵은 슬라이스와 같다 (0 dB ~ minDb). */
export function surfaceColors(
  levels: Map<string, Float32Array>,
  minDb: number,
): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  for (const [id, lv] of levels) {
    const c = new Float32Array(lv.length * 3);
    for (let t = 0; t < lv.length; t++) {
      const [r, g, b] = colormap(levelToT(lv[t]!, minDb));
      c[t * 3] = r / 255;
      c[t * 3 + 1] = g / 255;
      c[t * 3 + 2] = b / 255;
    }
    out.set(id, c);
  }
  return out;
}
