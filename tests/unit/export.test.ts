import { describe, expect, it } from 'vitest';
import { encodeGif } from '../../src/io/gif';
import { echoCsv, resultsCsv, sliceCsv } from '../../src/io/exportCsv';
import { flatBands } from '../../src/solver/core/bands';

const row = {
  name: 'R, "1"',
  distance: 5,
  delayMs: 14.577,
  visible: true,
  bandDb: flatBands(-3),
  totalDb: -2.5,
  directDb: -14,
  reflDb: -6,
  diffDb: -Infinity,
  scatDb: -4,
  scatSeDb: 0.2,
  nRefl: 7,
  nDiff: 0,
};

describe('내보내기', () => {
  it('결과 CSV: 머리글·셀 수·따옴표 이스케이프·무한대는 빈 칸', () => {
    const t = resultsCsv([row]).trim().split('\n');
    expect(t).toHaveLength(2);
    expect(t[1]!.startsWith('"R, ""1""",5.000,14.577,1')).toBe(true);
    expect(t[0]!.split(',')).toHaveLength(18); // 머리글 열 수
    expect(t[1]).toContain(',,'); // 회절 −∞ → 빈 칸
  });
  it('에코그램 CSV: 구간 수만큼 줄, 합계 = 성분 합', () => {
    const e = {
      dtMs: 2,
      nBins: 3,
      direct: Float64Array.from([0.5, 0, 0]),
      refl: Float64Array.from([0, 0.25, 0]),
      diff: new Float64Array(3),
      scat: Float64Array.from([0, 0, 0.125]),
    };
    const lines = echoCsv(e).trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(Number(lines[1]!.split(',')[5])).toBeCloseTo(0.5, 6);
    expect(Number(lines[3]!.split(',')[0])).toBeCloseTo(4, 6);
  });
  it('슬라이스 CSV: 셀 수만큼 줄', () => {
    const g = {
      nx: 2,
      ny: 3,
      x0: 0,
      y0: 0,
      cell: 1,
      z: 1.5,
      levels: new Float32Array(6).fill(-10),
    };
    expect(sliceCsv(g).trim().split('\n')).toHaveLength(7);
  });
  it('GIF: 헤더 GIF89a, 프레임 두 장이 들어간다', () => {
    const mk = (r: number) => {
      const d = new Uint8ClampedArray(8 * 8 * 4);
      for (let i = 0; i < 64; i++) d.set([r, 100, 200, 255], i * 4);
      return { data: d, width: 8, height: 8 };
    };
    const bytes = encodeGif([mk(10), mk(200)], 100);
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a');
    let imgs = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x2c) imgs++; // 이미지 구분자 근사
    expect(imgs).toBeGreaterThanOrEqual(2);
    expect(bytes[bytes.length - 1]).toBe(0x3b); // 종료 바이트
  });
});
