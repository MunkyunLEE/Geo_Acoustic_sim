import * as THREE from 'three';
import { getWeld, groupPos } from '../editor/subedit';
import type { MeshSurface } from '../types';

/** 편집 단계: 객체 전체 / 꼭짓점 / 모서리 / 면. */
export type EditLevel = 'object' | 'vertex' | 'edge' | 'face';

/** 꼭짓점·모서리·면 선택. groups는 용접된 꼭짓점 그룹 번호 (이동 대상). */
export interface SubSel {
  objectId: string;
  level: Exclude<EditLevel, 'object'>;
  groups: number[]; // 이동 대상 꼭짓점 그룹
  edges: [number, number][]; // 모서리 단계: 선택한 모서리 (그룹 쌍)
  tris: number[]; // 면 단계: 선택한 삼각형
}

const SEL = 0xff7a1a;

/** 선택한 객체 메시의 자식으로 꼭짓점·모서리·면 표시를 붙인다 (메시가 다시 만들어지면 다시 호출). */
export class SubLayer {
  private g: THREE.Group | null = null;

  clear(): void {
    if (!this.g) return;
    this.g.removeFromParent();
    this.g.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.g = null;
  }

  sync(
    mesh: THREE.Object3D | null,
    base: MeshSurface | null,
    level: EditLevel,
    sel: SubSel | null,
  ): void {
    this.clear();
    if (!mesh || !base || level === 'object') return;
    const w = getWeld(base);
    const g = new THREE.Group();
    const pts = (ids: number[], size: number, color: number) => {
      const a = new Float32Array(ids.length * 3);
      ids.forEach((id, i) => a.set(groupPos(base, w, id), i * 3));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(a, 3));
      const o = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }),
      );
      o.renderOrder = 10;
      g.add(o);
    };
    if (level === 'vertex')
      pts(
        w.groups.map((_, i) => i),
        7,
        0x8895a7,
      ); // 후보 꼭짓점
    const ok = sel && sel.objectId !== '' && sel.level === level;
    if (ok && level === 'vertex') pts(sel.groups, 12, SEL);
    if (ok && level === 'edge') {
      const a = new Float32Array(sel.edges.length * 6);
      sel.edges.forEach(([x, y], i) => {
        a.set(groupPos(base, w, x), i * 6);
        a.set(groupPos(base, w, y), i * 6 + 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(a, 3));
      const l = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: SEL, depthTest: false }),
      );
      l.renderOrder = 10;
      g.add(l);
      pts(sel.groups, 9, SEL);
    }
    if (ok && level === 'face') {
      const a = new Float32Array(sel.tris.length * 9);
      sel.tris.forEach((t, i) => {
        for (let k = 0; k < 3; k++) {
          const v = base.indices[t * 3 + k]! * 3;
          a.set(
            [base.positions[v]!, base.positions[v + 1]!, base.positions[v + 2]!],
            i * 9 + k * 3,
          );
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(a, 3));
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: SEL,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
          depthTest: false,
        }),
      );
      m.renderOrder = 9;
      g.add(m);
    }
    mesh.add(g);
    this.g = g;
  }
}
