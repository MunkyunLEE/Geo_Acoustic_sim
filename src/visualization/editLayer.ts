import * as THREE from 'three';
import type { ThemeName } from '../app/theme';
import type { EditorState, ObjectRole, SceneObject } from '../editor/types';
import type { MeshSurface, Vec3 } from '../types';

/** 선택 대상. domain은 3D 오브젝트가 없고 패널에서만 편집한다. */
export type Selection =
  { kind: 'object' | 'source' | 'receiver'; id: string } | { kind: 'domain'; id: 'domain' };

const ROLE_COLOR: Record<ObjectRole, number> = {
  reflect: 0x6c8ebf,
  absorber: 0x7fb685,
  obstacle: 0xc9a66b,
  open: 0x9aa5b1,
  custom: 0xb58bc9,
  emitter: 0xf0883e,
};
const SOURCE_COLOR = 0xff7a1a;
const RECEIVER_COLOR = 0x2b7bff;
const SELECT_COLOR = { light: 0x1f6feb, dark: 0x58a6ff };
const EDGE_COLOR = { light: 0x2f3b4a, dark: 0xaab6c5 };
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

interface ObjEntry {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  base: MeshSurface; // 형상이 바뀌었는지 판별 (참조 비교)
  overlay?: THREE.Mesh; // 결과 표면 색 (삼각형별)
  overlayFor?: Float32Array; // overlay를 만든 색 배열 (참조 비교)
}

/** 편집 가능한 객체·음원·수신점의 3D 표현. 상태를 받아 제자리 갱신하므로 기즈모 드래그 중에도 끊기지 않는다. */
export class EditLayer {
  readonly group = new THREE.Group();
  private objs = new Map<string, ObjEntry>();
  private markers = new Map<string, THREE.Mesh>(); // 키: source:<id> / receiver:<id>
  private surface: Map<string, Float32Array> | null = null; // 객체 id → 삼각형별 RGB

  /** 결과 표면 색을 지정한다 (null이면 제거). 다음 sync에서 반영된다. */
  setSurface(colors: Map<string, Float32Array> | null): void {
    this.surface = colors;
  }

  /** 상태를 3D에 반영한다. markerR은 음원 마커 반경 [m]. */
  sync(state: EditorState, sel: Selection | null, theme: ThemeName, markerR: number): void {
    const selColor = SELECT_COLOR[theme];
    const live = new Set<string>();
    for (const o of state.objects) {
      live.add(o.id);
      let e = this.objs.get(o.id);
      if (!e || e.base !== o.base) {
        if (e) this.removeObj(o.id);
        e = this.createObj(o);
        this.objs.set(o.id, e);
        this.group.add(e.mesh);
      }
      const t = o.transform;
      e.mesh.position.set(...t.position);
      e.mesh.rotation.set(
        t.rotationDeg[0] * RAD,
        t.rotationDeg[1] * RAD,
        t.rotationDeg[2] * RAD,
        'XYZ',
      );
      e.mesh.scale.set(...t.scale);
      const isSel = sel?.kind === 'object' && sel.id === o.id;
      const m = e.mesh.material as THREE.MeshLambertMaterial;
      m.color.setHex(ROLE_COLOR[o.role]);
      m.opacity = (o.role === 'open' ? 0.25 : theme === 'dark' ? 0.4 : 0.55) + (isSel ? 0.2 : 0);
      (e.edges.material as THREE.LineBasicMaterial).color.setHex(
        isSel ? selColor : EDGE_COLOR[theme],
      );
      e.mesh.visible = o.visible;
      this.syncOverlay(e, this.surface?.get(o.id) ?? null);
    }
    for (const id of [...this.objs.keys()]) if (!live.has(id)) this.removeObj(id);

    const liveM = new Set<string>();
    const place = (
      kind: 'source' | 'receiver',
      id: string,
      pos: Vec3,
      color: number,
      r: number,
    ) => {
      const key = `${kind}:${id}`;
      liveM.add(key);
      let m = this.markers.get(key);
      if (!m) {
        m = new THREE.Mesh(
          new THREE.SphereGeometry(1, 20, 14),
          new THREE.MeshBasicMaterial({ color }),
        );
        m.userData = { kind, id };
        this.markers.set(key, m);
        this.group.add(m);
      }
      m.scale.setScalar(r);
      m.position.set(...pos);
      const isSel = sel?.kind === kind && sel.id === id;
      (m.material as THREE.MeshBasicMaterial).color.setHex(isSel ? selColor : color);
    };
    for (const s of state.sources) place('source', s.id, s.position, SOURCE_COLOR, markerR);
    for (const r of state.receivers)
      place('receiver', r.id, r.position, RECEIVER_COLOR, Math.max(markerR * 0.7, 0.1));
    for (const [k, m] of [...this.markers]) {
      if (liveM.has(k)) continue;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.group.remove(m);
      this.markers.delete(k);
    }
  }

  /** 삼각형별 색 오버레이를 만들거나 지운다. 삼각형 수가 다르면(오래된 결과) 표시하지 않는다. */
  private syncOverlay(e: ObjEntry, rgb: Float32Array | null): void {
    const nTri = e.base.indices.length / 3;
    const want = rgb && rgb.length === nTri * 3 ? rgb : null;
    if (e.overlayFor === (want ?? undefined)) return;
    if (e.overlay) {
      e.overlay.geometry.dispose();
      (e.overlay.material as THREE.Material).dispose();
      e.mesh.remove(e.overlay);
      e.overlay = undefined;
    }
    e.overlayFor = want ?? undefined;
    if (!want) return;
    const pos = new Float32Array(nTri * 9);
    const col = new Float32Array(nTri * 9);
    for (let t = 0; t < nTri; t++)
      for (let k = 0; k < 3; k++) {
        const v = e.base.indices[t * 3 + k]! * 3;
        pos.set(
          [e.base.positions[v]!, e.base.positions[v + 1]!, e.base.positions[v + 2]!],
          t * 9 + k * 3,
        );
        col.set([want[t * 3]!, want[t * 3 + 1]!, want[t * 3 + 2]!], t * 9 + k * 3);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    e.overlay = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    e.mesh.add(e.overlay);
  }

  private createObj(o: SceneObject): ObjEntry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(o.base.positions.slice(), 3));
    geo.setIndex(new THREE.BufferAttribute(o.base.indices.slice(), 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    mesh.userData = { kind: 'object', id: o.id };
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 30),
      new THREE.LineBasicMaterial(),
    );
    mesh.add(edges);
    return { mesh, edges, base: o.base };
  }

  private removeObj(id: string): void {
    const e = this.objs.get(id);
    if (!e) return;
    e.mesh.geometry.dispose();
    (e.mesh.material as THREE.Material).dispose();
    e.edges.geometry.dispose();
    (e.edges.material as THREE.Material).dispose();
    this.group.remove(e.mesh);
    this.objs.delete(id);
  }

  /** 레이캐스트 대상 (객체 메시 + 마커). 마커를 앞에 둬서 같은 거리면 마커가 우선된다. */
  pickables(): THREE.Object3D[] {
    return [...this.markers.values(), ...[...this.objs.values()].map((e) => e.mesh)];
  }

  /** 선택에 해당하는 3D 오브젝트. */
  find(sel: Selection | null): THREE.Object3D | null {
    if (!sel || sel.kind === 'domain') return null;
    if (sel.kind === 'object') return this.objs.get(sel.id)?.mesh ?? null;
    return this.markers.get(`${sel.kind}:${sel.id}`) ?? null;
  }

  dispose(): void {
    for (const id of [...this.objs.keys()]) this.removeObj(id);
    for (const m of this.markers.values()) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.markers.clear();
  }
}

/** 3D 오브젝트의 현재 변환을 편집기 Transform으로 읽는다 (회전은 Euler XYZ, 도 단위). */
export function readTransform(o: THREE.Object3D): {
  position: Vec3;
  rotationDeg: Vec3;
  scale: Vec3;
} {
  return {
    position: [o.position.x, o.position.y, o.position.z],
    rotationDeg: [o.rotation.x * DEG, o.rotation.y * DEG, o.rotation.z * DEG],
    scale: [o.scale.x, o.scale.y, o.scale.z],
  };
}
