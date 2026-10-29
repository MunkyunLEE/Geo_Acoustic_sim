import * as THREE from 'three';
import { boundingBox, diagonal } from '../geometry/primitives';
import type { ThemeName } from '../app/theme';
import { FACE_IDS, type Scene, type Vec3 } from '../types';
import { makeDomainMeshes } from '../geometry/domain';

/** 재료 순서별 표시 색 (표시 전용). */
const PALETTE = [0x6c8ebf, 0xc9a66b, 0x7fb685, 0xb58bc9, 0xd98c8c];
/** 테마별 3D 표시 색 (표시 전용). */
const THEME_COLORS: Record<
  ThemeName,
  { grid: number; gridSub: number; edge: number; opacity: number }
> = {
  light: { grid: 0x8a94a0, gridSub: 0xc3c9d0, edge: 0x2f3b4a, opacity: 0.5 },
  dark: { grid: 0x6b7683, gridSub: 0x333b45, edge: 0xaab6c5, opacity: 0.32 },
};

export interface BuiltScene {
  group: THREE.Group; // 장면 오브젝트 묶음 (Z-up, 단위 m)
  center: THREE.Vector3; // 장면 중심 [m]
  diagonal: number; // 바운딩 박스 대각선 [m]
  dispose: () => void; // GPU 자원 해제
}

/** Scene(데이터)을 Three.js 오브젝트로 변환한다. 계산 코드와 분리된 표시 전용 코드. */
export function buildSceneObjects(scene: Scene, theme: ThemeName = 'light'): BuiltScene {
  const tc = THEME_COLORS[theme]; // 테마 색
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T): T => (disposables.push(o), o);

  const points: Vec3[] = [
    ...scene.sources.flatMap((s) => (s.kind === 'point' ? [s.position] : [])),
    ...scene.receivers.map((r) => r.position),
  ];
  const box = boundingBox([], [...points, scene.domain.min, scene.domain.max]) ?? {
    min: [-5, -5, 0] as Vec3,
    max: [5, 5, 3] as Vec3,
  };
  const diag = Math.max(diagonal(box), 1);
  const center = new THREE.Vector3(
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  );

  // 바닥 그리드: XY 평면 (Z-up), 가장 낮은 z 또는 0 높이
  const extent = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], 10);
  const gridSize = Math.ceil((extent * 1.5) / 10) * 10;
  const grid = new THREE.GridHelper(
    gridSize,
    gridSize > 100 ? gridSize / 10 : gridSize,
    tc.grid,
    tc.gridSub,
  );
  grid.rotation.x = Math.PI / 2; // GridHelper 기본은 XZ 평면이므로 XY로 눕힌다
  grid.position.set(center.x, center.y, box.min[2] - 0.01);
  group.add(grid);
  track(grid.geometry);
  track(grid.material as THREE.Material);

  // 축: X 빨강, Y 초록, Z 파랑
  const axes = new THREE.AxesHelper(diag * 0.15);
  group.add(axes);
  track(axes.geometry);
  track(axes.material as THREE.Material);

  // 해석 영역: 모서리선은 항상, 반사 면은 반투명 면, 소산 면은 면 없이 점선 느낌의 옅은 면으로 구분
  const dom = scene.domain;
  const size = [0, 1, 2].map((i) => dom.max[i]! - dom.min[i]!);
  const boxGeo = track(new THREE.BoxGeometry(size[0], size[1], size[2]));
  const boxEdges = track(new THREE.EdgesGeometry(boxGeo));
  const boxLine = new THREE.LineSegments(
    boxEdges,
    track(new THREE.LineBasicMaterial({ color: tc.edge })),
  );
  boxLine.position.set(
    (dom.min[0] + dom.max[0]) / 2,
    (dom.min[1] + dom.max[1]) / 2,
    (dom.min[2] + dom.max[2]) / 2,
  );
  group.add(boxLine);
  makeDomainMeshes(dom).forEach((m, i) => {
    const face = dom.faces[FACE_IDS[i]!];
    if (face.type === 'open') return; // 소산 면은 면을 그리지 않는다 (모서리선만)
    const matIndex = Math.max(
      0,
      scene.materials.findIndex((x) => x.id === face.materialId),
    );
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions.slice(), 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices.slice(), 1));
    const mat = track(
      new THREE.MeshBasicMaterial({
        color: PALETTE[matIndex % PALETTE.length],
        side: THREE.DoubleSide,
        transparent: true,
        opacity: tc.opacity * 0.35,
        depthWrite: false,
      }),
    );
    group.add(new THREE.Mesh(geo, mat));
  });

  return { group, center, diagonal: diag, dispose: () => disposables.forEach((d) => d.dispose()) };
}
