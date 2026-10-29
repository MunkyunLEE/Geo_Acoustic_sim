import { applyPalette, GIFEncoder, quantize } from 'gifenc';

/** RGBA 프레임 한 장. */
export interface RgbaFrame {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * 프레임들을 애니메이션 GIF로 만든다 (프레임마다 256색 팔레트, 무한 반복).
 * delayMs는 프레임 간격 [ms]이며 GIF는 1/100 s 단위라 반올림된다.
 */
export function encodeGif(frames: readonly RgbaFrame[], delayMs: number): Uint8Array {
  const gif = GIFEncoder();
  for (const f of frames) {
    const palette = quantize(f.data, 256);
    const index = applyPalette(f.data, palette);
    gif.writeFrame(index, f.width, f.height, {
      palette,
      delay: Math.max(20, Math.round(delayMs)),
      repeat: 0,
    });
  }
  gif.finish();
  return gif.bytes();
}
