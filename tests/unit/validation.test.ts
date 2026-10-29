import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_SCENES,
  barrierScene,
  boxRoomScene,
  freeFieldScene,
} from '../../src/data/examples';
import { flatBands } from '../../src/solver/core/bands';
import { hasErrors, validateScene } from '../../src/solver/core/validation';
import type { Scene } from '../../src/types';

const clone = (s: Scene): Scene => structuredClone(s);
const codes = (s: Scene) => validateScene(s).map((i) => i.code);

describe('장면 검증', () => {
  it('내장 예시 장면은 모두 오류가 없다 (예시 재료 경고만 허용)', () => {
    for (const scene of EXAMPLE_SCENES) {
      const issues = validateScene(scene);
      expect(hasErrors(issues), scene.name).toBe(false);
      expect(issues.every((i) => i.code === 'material-example')).toBe(true);
    }
  });

  it('예시 재료 경고는 실제 사용하는 재료에만 나온다', () => {
    expect(validateScene(freeFieldScene)).toEqual([]); // 반사 면·메시가 없으므로 경고 없음
    const issues = validateScene(boxRoomScene).filter((i) => i.code === 'material-example');
    expect(issues).toHaveLength(1); // 박스 룸은 재료 1개만 사용
  });

  it('흡음률이 0~1을 벗어나면 오류', () => {
    const s = clone(boxRoomScene);
    s.materials[0]!.absorption = flatBands(1.2);
    expect(codes(s)).toContain('material-range');
  });

  it('없는 재료를 참조하면 오류', () => {
    const s = clone(barrierScene);
    s.meshes[0]!.materialId = 'nope';
    expect(codes(s)).toContain('mesh-material');
  });

  it('범위를 벗어난 인덱스와 NaN 좌표는 오류', () => {
    const s = clone(barrierScene);
    s.meshes[0]!.indices[0] = 999;
    s.meshes[0]!.positions[0] = Number.NaN;
    expect(codes(s)).toEqual(expect.arrayContaining(['mesh-index', 'mesh-nonfinite']));
  });

  it('퇴화 삼각형은 경고', () => {
    const s = clone(barrierScene);
    s.meshes[0]!.indices.set([0, 0, 0], 0);
    const issue = validateScene(s).find((i) => i.code === 'mesh-degenerate');
    expect(issue?.severity).toBe('warning');
  });

  it('id 중복, 수신기 반경 0, 유한하지 않은 Lw는 오류', () => {
    const s = clone(boxRoomScene);
    s.receivers[1]!.id = s.receivers[0]!.id;
    s.receivers[0]!.radius = 0;
    (s.sources[0] as { lw: Record<number, number> }).lw[1000] = Number.NaN;
    expect(codes(s)).toEqual(
      expect.arrayContaining(['duplicate-id', 'receiver-radius', 'source-lw']),
    );
  });

  it('음원이 없으면 경고, 면음원은 미지원 경고', () => {
    const s = clone(boxRoomScene);
    s.sources = [];
    expect(codes(s)).toContain('no-source');
    s.sources = [{ kind: 'area', id: 'a1', name: '면', meshId: 'room', lw: flatBands(90) }];
    expect(codes(s)).toContain('source-area-unsupported');
  });
});

describe('해석 영역 검증', () => {
  it('영역 크기가 0 이하이면 오류', () => {
    const s = clone(boxRoomScene);
    s.domain.max = [s.domain.min[0], 10, 10];
    expect(codes(s)).toContain('domain-size');
  });
  it('반사 면이 없는 재료를 참조하면 오류', () => {
    const s = clone(boxRoomScene);
    s.domain.faces.xmax = { type: 'reflect', materialId: 'nope' };
    expect(codes(s)).toContain('domain-material');
  });
  it('음원이 영역 밖이면 오류', () => {
    const s = clone(boxRoomScene);
    (s.sources[0] as unknown as { position: number[] }).position = [50, 0, 0];
    expect(codes(s)).toContain('source-outside');
  });
});
