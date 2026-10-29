import type { Vec3 } from '../../types';
import { evaluateField, type FieldContext } from '../physics/field';
import { levelFromWeights, selectionWeights, type LevelSelection } from '../physics/direct';

export interface SliceGrid {
  nx: number; // x 방향 셀 수
  ny: number; // y 방향 셀 수
  x0: number; // 격자 시작 x [m]
  y0: number; // 격자 시작 y [m]
  cell: number; // 셀 크기 [m]
  z: number; // 슬라이스 높이 [m]
  levels: Float32Array; // 상대 레벨 [dB], 계산할 성분이 없으면 -Infinity, 행 우선 (ny × nx)
}

export interface SliceOptions {
  min: Vec3; // 영역 최소점 [m]
  max: Vec3; // 영역 최대점 [m]
  z: number; // 슬라이스 높이 [m]
  ctx?: FieldContext; // 단일 음원 문맥 (level이 없을 때 사용)
  sel?: LevelSelection; // 표시 레벨 (ctx와 함께)
  level?: (p: Vec3) => number; // 임의의 점 레벨 함수 [dB] (다중 음원은 이쪽을 사용)
  maxCells?: number; // 한 변 최대 셀 수 (기본 100)
}

/** 수평 슬라이스의 상대 레벨 격자 (직접음 + 반사 + 회절). 셀 중심에서 계산한다. */
export function computeSlice(o: SliceOptions): SliceGrid {
  const maxCells = o.maxCells ?? 100; // 한 변 최대 셀 수
  const w = o.max[0] - o.min[0];
  const h = o.max[1] - o.min[1];
  const cell = Math.max(w, h, 1e-6) / maxCells;
  const nx = Math.max(1, Math.ceil(w / cell));
  const ny = Math.max(1, Math.ceil(h / cell));
  const levels = new Float32Array(nx * ny);
  const ctx = o.ctx;
  const wts = ctx ? selectionWeights(ctx.lw, o.sel ?? 'total') : []; // 밴드 가중치 (셀마다 다시 만들지 않음)
  const at =
    o.level ??
    ((p: Vec3) => {
      if (!ctx) throw new Error('computeSlice에는 level 또는 ctx가 필요합니다.');
      return levelFromWeights(evaluateField(ctx, p).total, wts);
    });
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p: Vec3 = [o.min[0] + (i + 0.5) * cell, o.min[1] + (j + 0.5) * cell, o.z];
      levels[j * nx + i] = at(p);
    }
  }
  return { nx, ny, x0: o.min[0], y0: o.min[1], cell, z: o.z, levels };
}
