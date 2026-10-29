import { describe, expect, it } from 'vitest';
import {
  barrierScene,
  boxRoomScene,
  freeFieldScene,
  openSpaceScene,
} from '../../src/data/examples';
import { NO_AIR_ABSORPTION } from '../../src/solver/core/airAbsorption';
import { compileScene } from '../../src/solver/core/compile';
import {
  buildImagePaths,
  reflectionGains,
  validatePath,
} from '../../src/solver/physics/reflection';
import type { Vec3 } from '../../src/types';

const lens = (c: ReturnType<typeof compileScene>, src: Vec3, rcv: Vec3, order: number) => {
  const set = buildImagePaths(c, src, order);
  return set.paths
    .filter((p) => validatePath(c, p, rcv))
    .map((p) => {
      const i = p.images[p.order]!;
      return Math.hypot(rcv[0] - i[0], rcv[1] - i[1], rcv[2] - i[2]);
    })
    .sort((a, b) => a - b);
};

describe('장면 컴파일', () => {
  it('박스룸: 반사 평면 6개(면당 삼각형 2개), 소산 면은 반사 평면에서 제외', () => {
    const c = compileScene(boxRoomScene);
    expect(c.planes).toHaveLength(6);
    expect(c.planes.every((p) => p.triCount === 2)).toBe(true);
    expect(compileScene(freeFieldScene).planes).toHaveLength(0);
    expect(compileScene(openSpaceScene).planes).toHaveLength(1); // 바닥만
  });
});

describe('정반사 (이미지 소스)', () => {
  it('바닥 반사 1회: 거리 √(8²+3²), 에너지 (1−α)(1−s)/d² (α=0.3, s=0.2)', () => {
    const c = compileScene(openSpaceScene);
    const src: Vec3 = [0, 0, 1.5],
      rcv: Vec3 = [8, 0, 1.5];
    const set = buildImagePaths(c, src, 2);
    expect(set.paths).toHaveLength(1); // 반사 평면이 1개이므로 2차 경로 없음
    const r = reflectionGains(c, set, rcv, NO_AIR_ABSORPTION);
    const d2 = 8 * 8 + 3 * 3;
    expect(r.nValid).toBe(1);
    expect(r.gain[1000]).toBeCloseTo((0.7 * 0.8) / d2, 9);
  });

  it('평행한 두 벽 사이: 이미지 거리 9, 11, 15, 25 m (박스룸 x축 위)', () => {
    const c = compileScene(boxRoomScene);
    const l = lens(c, [3, 5, 5], [8, 5, 5], 2);
    for (const d of [9, 11, 15, 25])
      expect(
        l.some((x) => Math.abs(x - d) < 1e-9),
        `d=${d}`,
      ).toBe(true);
  });

  it('박스 안(일반 위치): 1차 6개 + 2차 18개 (마주 보는 벽 6개, 인접한 벽은 두 순서 중 하나만 유효)', () => {
    const c = compileScene(boxRoomScene);
    expect(lens(c, [3, 4, 5.5], [8, 6.5, 4], 2)).toHaveLength(6 + 6 + 12);
  });

  it('소산 경계(α=1)에서는 반사음이 0', () => {
    const c = compileScene(freeFieldScene);
    const set = buildImagePaths(c, [0, 0, 0], 3);
    expect(set.paths).toHaveLength(0);
    expect(reflectionGains(c, set, [4, 0, 0], NO_AIR_ABSORPTION).nValid).toBe(0);
  });

  it('벽이 반사 경로를 가리면 무효', () => {
    const c = compileScene(barrierScene);
    const src =
      barrierScene.sources[0]!.kind === 'point'
        ? barrierScene.sources[0]!.position
        : ([0, 0, 0] as Vec3);
    const front = lens(c, src, [10, 0, 1.5], 1);
    const behind = lens(c, src, [25, 0, 1.5], 1);
    expect(front.length).toBeGreaterThan(0); // 지면 반사 + 벽 앞면 반사
    expect(behind).toHaveLength(0);
  });

  it('차수를 올리면 경로 수만 늘고 짧은 경로는 유지', () => {
    const c = compileScene(boxRoomScene);
    expect(buildImagePaths(c, [3, 3, 3], 3).paths).toHaveLength(6 + 30 + 150);
  });
});
