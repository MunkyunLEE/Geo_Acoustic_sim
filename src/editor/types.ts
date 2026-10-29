import type { Domain, Material, MeshSurface, PerBand, PointSource, Receiver, Vec3 } from '../types';

/** 면음원 설정. 객체(평면)를 nu × nv 표본점으로 나눠 점음원들로 계산한다 (표본점마다 파워를 균등 분할). */
export interface EmitterSpec {
  lw: PerBand<number>; // 면 전체의 밴드별 Lw [dB re 1 pW]
  nu: number; // 국소 x 방향 표본점 수 (1~5)
  nv: number; // 국소 y 방향 표본점 수 (1~5)
}

/** 객체 역할 프리셋. 값은 사용자가 고칠 수 있고, 고치면 custom이 된다. */
export type ObjectRole = 'reflect' | 'absorber' | 'obstacle' | 'open' | 'custom' | 'emitter';

/** 객체 변환. 크기 → 회전(Euler XYZ, three.js 규약) → 이동 순서로 적용한다. */
export interface Transform {
  position: Vec3; // 이동 [m]
  rotationDeg: Vec3; // Euler XYZ 회전 [deg]
  scale: Vec3; // 축별 크기 배율
}

/** 장면 객체. 서페이스(열린 면 허용)와 변환, 자기 재료를 가진다. */
export interface SceneObject {
  id: string; // 고유 id
  name: string; // 표시 이름
  role: ObjectRole; // 역할 프리셋
  base: MeshSurface; // 국소 좌표의 형상 (재료 id는 쓰지 않음)
  transform: Transform; // 국소 → 세계 변환
  material: Material; // 이 객체의 재료 (id = mat-<객체 id>)
  emitter?: EmitterSpec; // 있으면 면음원 (소리를 내며 음향적으로는 투명, 재료 무시)
  visible: boolean; // false면 계산·표시에서 제외하지 않고 표시만 숨김 (현재는 사용 안 함)
}

/** 편집기 상태. 계산용 Scene은 toScene()으로 만든다. */
export interface EditorState {
  name: string; // 장면 이름
  domain: Domain; // 해석 영역(박스)
  objects: SceneObject[]; // 객체 목록
  sources: PointSource[]; // 점음원 (면음원은 STEP 6)
  receivers: Receiver[]; // 수신점
}

export const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
};
