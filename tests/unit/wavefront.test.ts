import { describe, expect, it } from 'vitest';
import { boxRoomScene, freeFieldScene, openSpaceScene } from '../../src/data/examples';
import { NO_AIR_ABSORPTION } from '../../src/solver/core/airAbsorption';
import { flatBands } from '../../src/solver/core/bands';
import { compileScene } from '../../src/solver/core/compile';
import { selectionWeights } from '../../src/solver/physics/direct';
import { colormap, levelToT } from '../../src/visualization/colormap';
import { WaveClock } from '../../src/visualization/waveClock';
import {
  buildSurfaceIndices,
  buildWaveModel,
  fillWave,
  icosphere,
  makeSpreadLut,
  makeWaveFrame,
} from '../../src/visualization/wavefrontModel';

const lw = flatBands(94);

describe('icosphere', () => {
  it('2단계: 정점 162, 면 320, 모두 단위 길이', () => {
    const s = icosphere(2);
    expect(s.dirs.length / 3).toBe(162);
    expect(s.faces.length / 3).toBe(320);
    for (let i = 0; i < 162; i++)
      expect(Math.hypot(s.dirs[i * 3]!, s.dirs[i * 3 + 1]!, s.dirs[i * 3 + 2]!)).toBeCloseTo(1, 5);
  });
});

describe('반사 파면 모델', () => {
  it('박스룸: 모든 광선이 2차까지 반사해 세그먼트 3개', () => {
    const m = buildWaveModel(compileScene(boxRoomScene), [3, 3, 3], 2, 3);
    expect(m.segCount.every((c) => c === 3)).toBe(true);
  });

  it('반사 법칙: 반사 후 위치는 이미지 소스에서 경로 길이만큼 떨어져 있다', () => {
    const m = buildWaveModel(compileScene(boxRoomScene), [3, 3, 3], 2, 4);
    const image = [-3, 3, 3]; // x = 0 평면에 대한 음원의 이미지
    let checked = 0;
    for (let i = 0; i < m.n; i++) {
      const o = (i * m.maxSeg + 1) * 3;
      if (Math.abs(m.segOrigin[o]!) > 1e-4 || m.segDir[o]! <= 0) continue; // 첫 반사가 x=0 벽인 광선
      const L0 = m.segL0[i * m.maxSeg + 1]!;
      const t = 0.5 * m.segLen[i * m.maxSeg + 1]!;
      const p = [0, 1, 2].map((k) => m.segOrigin[o + k]! + m.segDir[o + k]! * t);
      const d = Math.hypot(p[0]! - image[0]!, p[1]! - image[1]!, p[2]! - image[2]!);
      expect(Math.abs(d - (L0 + t))).toBeLessThan(2e-3);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('열린 공간(바닥만 반사): 아래로 가는 광선(약 절반)만 반사 후 소멸', () => {
    const m = buildWaveModel(compileScene(openSpaceScene), [0, 0, 1.5], 2, 4);
    const two = Array.from(m.segCount).filter((c) => c === 2).length;
    expect(two / m.n).toBeGreaterThan(0.4);
    expect(two / m.n).toBeLessThan(0.6);
    expect(Array.from(m.segCount).every((c) => c <= 2)).toBe(true);
  });

  it('같은 시드는 같은 모델', () => {
    const c = compileScene(boxRoomScene);
    const a = buildWaveModel(c, [3, 3, 3], 1, 3),
      b = buildWaveModel(c, [3, 3, 3], 1, 3);
    expect(Array.from(a.jitter.slice(0, 20))).toEqual(Array.from(b.jitter.slice(0, 20)));
    expect(Array.from(a.endLen.slice(0, 20))).toEqual(Array.from(b.endLen.slice(0, 20)));
  });
});

describe('파면 채우기와 표면', () => {
  it('직접음 구간의 색은 −20log10(r) 레벨의 컬러맵과 일치 (r = 2 m, 자유장)', () => {
    const m = buildWaveModel(compileScene(freeFieldScene), [0, 0, 0], 1, 3);
    const frame = makeWaveFrame(m.n);
    const lut = makeSpreadLut(30, NO_AIR_ABSORPTION, 4096);
    fillWave(m, 2, 0, lut, selectionWeights(lw, 'total'), -60, frame);
    const exp = colormap(levelToT(-20 * Math.log10(2), -60));
    expect(frame.alive.every((a) => a === 1)).toBe(true);
    expect(frame.colors[0]! * 255).toBeCloseTo(exp[0], 0);
    expect(frame.colors[1]! * 255).toBeCloseTo(exp[1], 0);
  });

  it('표면 인덱스: 작은 반경의 자유장에서는 모든 면이 그려지고, 벽을 지나면 광선이 사라짐', () => {
    const c = compileScene(freeFieldScene);
    const m = buildWaveModel(c, [0, 0, 0], 1, 3);
    const frame = makeWaveFrame(m.n);
    const lut = makeSpreadLut(40, NO_AIR_ABSORPTION);
    const w = selectionWeights(lw, 'total');
    const idx = new Uint32Array(m.faces.length);
    fillWave(m, 3, 0, lut, w, -60, frame);
    expect(buildSurfaceIndices(m, frame, 3, 3, idx)).toBe(m.faces.length);
    fillWave(m, 100, 0, lut, w, -60, frame);
    expect(frame.alive.every((a) => a === 0)).toBe(true);
  });
});

describe('컬러맵·시계', () => {
  it('컬러맵 고정, 시계 진행·정지', () => {
    expect(colormap(-1)).toEqual(colormap(0));
    expect(levelToT(-30, -60)).toBeCloseTo(0.5, 6);
    expect(levelToT(-Infinity, -60)).toBe(0);
    const c = new WaveClock();
    c.tMax = 1;
    c.speed = 0.5;
    c.playing = true;
    c.loop = false;
    c.tick(1);
    expect(c.t).toBeCloseTo(0.5, 6);
    c.tick(5);
    expect(c.t).toBe(1);
    expect(c.playing).toBe(false);
  });
});
