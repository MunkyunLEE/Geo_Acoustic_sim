import type { PerBand, Vec3 } from './acoustics';

/** 장면 파일 형식 버전. 형식이 바뀌면 올린다. */
export const SCENE_SCHEMA_VERSION = 2;

/** 표면 재료. 계수는 모두 밴드별 0~1. */
export interface Material {
  id: string; // 고유 id
  name: string; // 화면 표시 이름
  absorption: PerBand<number>; // 흡음률 α(f)
  scattering: PerBand<number>; // 산란 계수 s(f)
  transmission?: PerBand<number>; // 투과율 τ(f) = 10^(−TL/10) (에너지 비). 없으면 0. α + τ ≤ 1
  isExample: boolean; // true = 예시 값 (출처 미확인, 실측 데이터 아님)
}

/** 삼각형 메시 표면. 좌표는 이미 m 단위 (임포트 경계에서 변환 완료). */
export interface MeshSurface {
  id: string; // 고유 id
  name: string; // 화면 표시 이름
  positions: Float32Array; // [x0,y0,z0, x1,y1,z1, ...] [m]
  indices: Uint32Array; // 삼각형 꼭짓점 인덱스 (3개씩)
  materialId: string; // Material.id 참조
}

/** 점음원. lw는 파워 레벨 [dB re 1 pW] 이며 음압 레벨(Lp)이 아니다. */
export interface PointSource {
  kind: 'point';
  id: string;
  name: string;
  position: Vec3; // [m]
  lw: PerBand<number>; // 밴드별 Lw [dB re 1 pW]
  samples?: number; // 면음원의 표본점 하나라면 전체 표본점 수 (Lw는 이미 나눠져 있음, 확산 레이 배분에 사용)
}

/** 면음원. 타입만 정의하며 구현은 STEP 5. */
export interface AreaSource {
  kind: 'area';
  id: string;
  name: string;
  meshId: string; // 음원 면을 이루는 MeshSurface.id
  lw: PerBand<number>; // 면 전체의 밴드별 Lw [dB re 1 pW]
}

export type Source = PointSource | AreaSource;

/** 수신점. 크기 0의 점이 아니라 유한한 수신 구 (물리 문서 9장). */
export interface Receiver {
  id: string;
  name: string;
  position: Vec3; // [m]
  radius: number; // 수신 구 반경 [m]
}

/** 해석 영역(박스)의 면 이름. x/y/z의 min·max 면. */
export type FaceId = 'xmin' | 'xmax' | 'ymin' | 'ymax' | 'zmin' | 'zmax';
export const FACE_IDS: readonly FaceId[] = ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'];

/** 경계 조건: reflect = 재료 흡음을 적용한 반사, open = 소산(광선이 나가면 소멸, α=1). */
export type BoundaryType = 'reflect' | 'open';

export interface DomainFace {
  type: BoundaryType; // 경계 조건
  materialId: string; // 반사 면의 재료 (open이면 무시)
}

/** 해석 영역. 음원·수신점은 이 박스 안에 있어야 하며, 6개 면에 경계 조건을 준다. */
export interface Domain {
  min: Vec3; // 최소 모서리 [m]
  max: Vec3; // 최대 모서리 [m]
  faces: Record<FaceId, DomainFace>; // 면별 경계 조건
}

export interface Scene {
  schemaVersion: typeof SCENE_SCHEMA_VERSION;
  name: string;
  units: 'm'; // 장면 내부 단위는 항상 m
  domain: Domain; // 해석 영역(박스)과 경계 조건
  meshes: MeshSurface[]; // 영역 안의 객체 (임포트한 STL/OBJ 등)
  materials: Material[];
  sources: Source[];
  receivers: Receiver[];
}
