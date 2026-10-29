import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ThemeName } from '../app/theme';
import type { Pt2 } from '../editor/shapes';
import type { EditorState, Transform } from '../editor/types';
import type { SliceGrid } from '../solver/receivers/slice';
import type { Scene, Vec3 } from '../types';
import { colormap, levelToT } from '../visualization/colormap';
import {
  faceTriangles,
  getWeld,
  groupPos,
  groupsCentroid,
  groupsOfTriangles,
  nearestEdge,
} from '../editor/subedit';
import { SubLayer, type EditLevel, type SubSel } from '../visualization/subLayer';
import { EditLayer, readTransform, type Selection } from '../visualization/editLayer';
import { buildSceneObjects, type BuiltScene } from '../visualization/sceneObjects';
import type { WaveClock } from '../visualization/waveClock';
import {
  buildSurfaceIndices,
  fillWave,
  makeWaveFrame,
  type SpreadLut,
  type WaveFrame,
  type WaveModel,
} from '../visualization/wavefrontModel';

export type WaveStyle = 'points' | 'surface';

export interface WaveView {
  model: WaveModel; // 광선 모델 (반사를 따라감)
  lut: SpreadLut; // 경로 길이 → 거리 감쇠 표
  weights: number[]; // 밴드 가중치
  thickness: number; // 점 표시 껍질 두께 [m]
  c: number; // 음속 [m/s]
  level: number; // icosphere 세분 단계
  style: WaveStyle; // 점 / 면
}

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface ViewportProps {
  domainScene: Scene; // 해석 영역·격자 표시용 (객체 없음)
  editor: EditorState; // 편집 대상 (객체·음원·수신점)
  selection: Selection | null;
  gizmoMode: GizmoMode;
  snap: { on: boolean; step: number }; // 그리드 스냅 (이동 step [m], 회전 15°)
  draw: { active: boolean; points: Pt2[]; z: number }; // 폴리라인 그리기 도구
  fitKey: number; // 바뀌면 카메라를 장면에 맞춘다
  theme: ThemeName;
  slice: SliceGrid | null; // Run 결과 슬라이스 (없으면 표시 안 함)
  showSlice: boolean;
  minDb: number; // 컬러맵 하한 [dB]
  waves: WaveView[]; // Run 결과 파면 (음원별, 없으면 표시 안 함)
  showWave: boolean;
  surfaceColors: Map<string, Float32Array> | null; // 객체 표면 입사 레벨 색 (없으면 역할 색)
  clock: WaveClock;
  onSelect: (s: Selection | null) => void;
  onTransform: (id: string, t: Transform) => void;
  onMoveMarker: (kind: 'source' | 'receiver', id: string, p: Vec3) => void;
  onDrawPoint: (p: Pt2) => void;
  editLevel: EditLevel; // 객체 / 꼭짓점 / 모서리 / 면
  subSel: SubSel | null;
  onSubPick: (s: SubSel | null) => void;
  onSubMove: (objectId: string, groups: number[], delta: Vec3) => void; // delta: 객체 국소 좌표 [m]
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  three: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  built: BuiltScene | null;
  layer: EditLayer;
  gizmo: TransformControls;
  sub: SubLayer;
  proxy: THREE.Object3D; // 꼭짓점·모서리·면 선택 중심에 놓는 기즈모 대상
  proxyLast: THREE.Vector3;
  draft: THREE.Group | null;
  slice: THREE.Mesh | null;
  waves: {
    points: THREE.Points;
    mesh: THREE.Mesh;
    frame: WaveFrame;
    pos: Float32Array; // 점 표시용으로 살아 있는 꼭짓점만 모은 버퍼
    col: Float32Array;
    idx: Uint32Array; // 면 표시용 인덱스
    model: WaveModel;
  }[];
  dirty: boolean; // 파면을 다시 채워야 함
  drawAt: (tSec: number) => void;
}

/** 3D 뷰포트. Z-up 궤도 카메라 + 편집(선택·기즈모·그리기) + Run 결과 표시. 계산은 하지 않는다. */
/** 바깥(GIF·PNG 내보내기)에서 쓰는 뷰포트 조작. */
export interface ViewportHandle {
  drawAt: (tSec: number) => void; // 시계와 무관하게 시각 t의 파면으로 한 프레임을 즉시 그린다
  canvas: () => HTMLCanvasElement | null;
}

export const Viewport = forwardRef<ViewportHandle, ViewportProps>(function Viewport(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [error, setError] = useState<string | null>(null);
  useImperativeHandle(ref, () => ({
    drawAt: (t: number) => ctxRef.current?.drawAt(t),
    canvas: () => ctxRef.current?.renderer.domElement ?? null,
  }));

  const fitView = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx?.built) return;
    const { center, diagonal } = ctx.built;
    const d = diagonal * 1.1;
    ctx.camera.near = Math.max(diagonal * 0.001, 0.01);
    ctx.camera.far = diagonal * 100;
    ctx.camera.updateProjectionMatrix();
    ctx.camera.position.set(center.x + d * 0.6, center.y - d * 0.8, center.z + d * 0.6);
    ctx.controls.target.copy(center);
    ctx.controls.update();
  }, []);

  // 렌더러·카메라·컨트롤·반복 루프 (한 번)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError('이 브라우저에서 WebGL을 사용할 수 없습니다.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // Z-up (Rhino와 동일)
    const three = new THREE.Scene();
    three.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1, -1.5, 2);
    three.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const layer = new EditLayer();
    three.add(layer.group);
    const gizmo = new TransformControls(camera, renderer.domElement);
    three.add(gizmo.getHelper());
    gizmo.addEventListener('dragging-changed', (e) => {
      controls.enabled = !(e as unknown as { value: boolean }).value; // 기즈모 드래그 중 궤도 회전 정지
    });
    const proxy = new THREE.Object3D();
    three.add(proxy);
    const proxyLast = new THREE.Vector3();
    const sub = new SubLayer();
    gizmo.addEventListener('objectChange', () => {
      const o = gizmo.object;
      if (o === proxy) {
        // 선택 중심 기즈모: 월드 이동량을 객체 국소 좌표 이동량으로 바꿔 전달
        const p = propsRef.current;
        const ss = p.subSel;
        const mesh = ss ? layer.find({ kind: 'object', id: ss.objectId }) : null;
        if (!ss || !mesh) return;
        mesh.updateWorldMatrix(true, false);
        const dw = proxy.position.clone().sub(proxyLast);
        proxyLast.copy(proxy.position);
        const inv = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld.clone().invert());
        const dl = dw.applyMatrix3(inv);
        p.onSubMove(ss.objectId, ss.groups, [dl.x, dl.y, dl.z]);
        return;
      }
      const u = o?.userData as { kind?: string; id?: string } | undefined;
      if (!o || !u?.id) return;
      const p = propsRef.current;
      const t = readTransform(o);
      if (u.kind === 'object') p.onTransform(u.id, t);
      else if (u.kind === 'source' || u.kind === 'receiver')
        p.onMoveMarker(u.kind, u.id, t.position);
    });
    const ctx: Ctx = {
      renderer,
      three,
      camera,
      controls,
      built: null,
      layer,
      gizmo,
      sub,
      proxy,
      proxyLast,
      draft: null,
      slice: null,
      waves: [],
      dirty: true,
      drawAt: () => undefined,
    };
    ctxRef.current = ctx;

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // 클릭(이동 4 px 미만): 그리기 도구면 점 추가, 아니면 객체·음원·수신점 선택
    let down: [number, number] | null = null;
    let downOnGizmo = false;
    const el = renderer.domElement;
    // 객체·음원·수신점 본체를 잡고 끌면 수평면(잡은 높이) 위에서 이동한다 (스냅 적용)
    let grab: {
      kind: 'object' | 'source' | 'receiver';
      id: string;
      plane: THREE.Plane;
      offset: THREE.Vector3;
      vertical: boolean;
      moved: boolean;
    } | null = null;
    const horizontalViewDir = () => {
      const d = new THREE.Vector3();
      camera.getWorldDirection(d);
      d.z = 0;
      return d.lengthSq() > 1e-9 ? d.normalize() : new THREE.Vector3(1, 0, 0);
    };
    const rayAt = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const rc = new THREE.Raycaster();
      rc.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -(((e.clientY - rect.top) / rect.height) * 2 - 1),
        ),
        camera,
      );
      return rc;
    };
    const onDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
      downOnGizmo = gizmo.axis !== null; // 기즈모 핸들을 잡은 클릭은 선택으로 보지 않는다
      grab = null;
      const p = propsRef.current;
      if (downOnGizmo || e.button !== 0 || p.draw.active) return;
      if (p.editLevel !== 'object' && p.selection?.kind === 'object') return; // 하위 요소 편집 중에는 본체 끌기 없음
      const hit = rayAt(e).intersectObjects(layer.pickables(), false)[0];
      const u = hit?.object.userData as
        { kind?: 'object' | 'source' | 'receiver'; id?: string } | undefined;
      if (!hit || !u?.kind || !u.id) return;
      grab = {
        kind: u.kind,
        id: u.id,
        // Shift: 카메라를 향한 수직 평면 위에서 높이(z)만 이동, 아니면 잡은 높이의 수평면
        plane: e.shiftKey
          ? new THREE.Plane().setFromNormalAndCoplanarPoint(horizontalViewDir(), hit.point)
          : new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.point.z),
        vertical: e.shiftKey,
        offset: hit.point.clone().sub(hit.object.position),
        moved: false,
      };
      controls.enabled = false; // 본체를 끄는 동안 궤도 회전 정지
      p.onSelect({ kind: u.kind, id: u.id });
    };
    const onMove = (e: PointerEvent) => {
      if (!grab || !down) return;
      if (!grab.moved && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) return;
      grab.moved = true;
      const obj = layer.find({ kind: grab.kind, id: grab.id });
      const pt = rayAt(e).ray.intersectPlane(grab.plane, new THREE.Vector3());
      if (!obj || !pt) return;
      const p = propsRef.current;
      const k = p.snap.on ? p.snap.step : 0;
      const q = (v: number) => (k > 0 ? Math.round(v / k) * k : Math.round(v * 100) / 100);
      const pos: Vec3 = grab.vertical
        ? [obj.position.x, obj.position.y, q(pt.z - grab.offset.z)]
        : [q(pt.x - grab.offset.x), q(pt.y - grab.offset.y), obj.position.z];
      if (grab.kind === 'object') p.onTransform(grab.id, { ...readTransform(obj), position: pos });
      else p.onMoveMarker(grab.kind, grab.id, pos);
    };
    const onUp = (e: PointerEvent) => {
      const p = propsRef.current;
      if (grab) {
        controls.enabled = true; // 끌기 종료 (클릭이든 이동이든 선택은 pointerdown에서 끝남)
        grab = null;
        return;
      }
      if (!down || downOnGizmo || e.button !== 0) return;
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      );
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, camera);
      if (p.draw.active) {
        const hit = rc.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 0, 1), -p.draw.z),
          new THREE.Vector3(),
        );
        if (!hit) return;
        const k = p.snap.on ? p.snap.step : 0;
        const q = (v: number) => (k > 0 ? Math.round(v / k) * k : Math.round(v * 100) / 100);
        p.onDrawPoint([q(hit.x), q(hit.y)]);
        return;
      }
      if (p.editLevel !== 'object' && p.selection?.kind === 'object') {
        const selId = p.selection.id;
        const mesh = layer.find(p.selection) as THREE.Mesh | null;
        const hit = mesh ? rc.intersectObject(mesh, false)[0] : undefined;
        const obj = p.editor.objects.find((o) => o.id === selId);
        if (hit && obj && hit.faceIndex != null) {
          const lp = mesh!.worldToLocal(hit.point.clone());
          p.onSubPick(
            pickSub(
              obj.base,
              selId,
              p.editLevel,
              hit.faceIndex,
              [lp.x, lp.y, lp.z],
              p.subSel,
              e.shiftKey,
            ),
          );
          return;
        }
      }
      const hits = rc.intersectObjects(layer.pickables(), false);
      const u = hits[0]?.object.userData as
        { kind?: 'object' | 'source' | 'receiver'; id?: string } | undefined;
      p.onSelect(u?.kind && u.id ? { kind: u.kind, id: u.id } : null);
    };
    el.addEventListener('pointerdown', onDown, true); // 캡처: 궤도 컨트롤보다 먼저 받아 회전을 막는다
    window.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);

    let raf = 0;
    let last = performance.now();
    let lastRadius = -1;
    // 파면 버퍼를 radius로 채운다 (force가 아니면 바뀐 경우만)
    const fillWaves = (radius: number, force: boolean) => {
      const p = propsRef.current;
      if (ctx.waves.length === p.waves.length && (force || ctx.dirty || radius !== lastRadius)) {
        ctx.waves.forEach((w, k) => {
          const wv = p.waves[k]!;
          const surface = wv.style === 'surface';
          w.points.visible = p.showWave && !surface;
          w.mesh.visible = p.showWave && surface;
          if (!p.showWave) return;
          // 면 표시는 정확히 radius, 점 표시는 두께를 둔 껍질
          fillWave(
            w.model,
            radius,
            surface ? 0 : wv.thickness,
            wv.lut,
            wv.weights,
            p.minDb,
            w.frame,
          );
          if (surface) {
            const n = buildSurfaceIndices(w.model, w.frame, radius, wv.level, w.idx);
            const g = w.mesh.geometry;
            g.setDrawRange(0, n);
            (g.getIndex() as THREE.BufferAttribute).needsUpdate = true;
            (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
            (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
          } else {
            let n = 0;
            const f = w.frame;
            for (let i = 0; i < w.model.n; i++) {
              if (!f.alive[i]) continue;
              w.pos.set(f.positions.subarray(i * 3, i * 3 + 3), n * 3);
              w.col.set(f.colors.subarray(i * 3, i * 3 + 3), n * 3);
              n++;
            }
            const g = w.points.geometry;
            g.setDrawRange(0, n);
            (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
            (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
          }
        });
        lastRadius = radius;
        ctx.dirty = false;
      }
    };
    ctx.drawAt = (tSec: number) => {
      const p = propsRef.current;
      fillWaves(p.waves[0] ? p.waves[0].c * tSec : 0, true);
      controls.update();
      renderer.render(three, camera);
    };
    const loop = (now: number) => {
      const p = propsRef.current;
      p.clock.tick(Math.min((now - last) / 1000, 0.1));
      last = now;
      fillWaves(p.waves[0] ? p.waves[0].c * p.clock.t : 0, false);
      controls.update();
      renderer.render(three, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      gizmo.dispose();
      sub.clear();
      layer.dispose();
      controls.dispose();
      ctx.built?.dispose();
      ctx.slice?.geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      ctxRef.current = null;
    };
  }, []);

  // 영역·격자는 영역·테마가 바뀔 때만 다시 만든다
  const { domainScene, theme } = props;
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.built) {
      ctx.three.remove(ctx.built.group);
      ctx.built.dispose();
    }
    ctx.built = buildSceneObjects(domainScene, theme);
    ctx.three.add(ctx.built.group);
  }, [domainScene, theme]);

  // 장면이 바뀌면(fitKey) 카메라를 맞춘다. 테마·편집 중에는 시점을 유지한다
  useEffect(() => {
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitKey]);

  // 객체·음원·수신점을 3D에 반영하고 선택 대상에 기즈모를 붙인다
  const { editor, selection, gizmoMode, snap } = props;
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx?.built) return;
    ctx.layer.setSurface(props.surfaceColors);
    ctx.layer.sync(editor, selection, theme, Math.max(0.15, ctx.built.diagonal * 0.012));
    const target = ctx.layer.find(selection);
    const g = ctx.gizmo;
    const subMode = props.editLevel !== 'object' && selection?.kind === 'object' && target;
    const obj =
      selection?.kind === 'object' ? editor.objects.find((o) => o.id === selection.id) : undefined;
    ctx.sub.sync(subMode ? target : null, obj?.base ?? null, props.editLevel, props.subSel);
    if (subMode && obj) {
      const ss = props.subSel;
      const c =
        ss && ss.objectId === obj.id
          ? groupsCentroid(obj.base, getWeld(obj.base), ss.groups)
          : null;
      if (c) {
        if (!g.dragging) {
          target.updateWorldMatrix(true, false);
          ctx.proxy.position.copy(target.localToWorld(new THREE.Vector3(...c)));
          ctx.proxyLast.copy(ctx.proxy.position);
        }
        if (g.object !== ctx.proxy) g.attach(ctx.proxy);
        g.setMode('translate');
        g.setSpace('world');
        g.setTranslationSnap(snap.on ? snap.step : null);
      } else if (g.object) g.detach();
    } else if (target) {
      if (g.object !== target) g.attach(target);
      const mode = selection?.kind === 'object' ? gizmoMode : 'translate'; // 음원·수신점은 이동만
      g.setMode(mode);
      g.setSpace(mode === 'scale' ? 'local' : 'world');
      g.setTranslationSnap(snap.on ? snap.step : null);
      g.setRotationSnap(snap.on ? (15 * Math.PI) / 180 : null);
      g.setScaleSnap(snap.on ? 0.1 : null);
    } else if (g.object) g.detach();
  }, [
    editor,
    selection,
    theme,
    domainScene,
    gizmoMode,
    snap,
    props.editLevel,
    props.subSel,
    props.surfaceColors,
  ]);

  // 폴리라인 그리기 중간 표시
  const { draw } = props;
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.draft) {
      ctx.three.remove(ctx.draft);
      ctx.draft.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
      ctx.draft = null;
    }
    if (!draw.active || draw.points.length === 0) return;
    const g = new THREE.Group();
    const pts = draw.points.map((p) => new THREE.Vector3(p[0], p[1], draw.z));
    g.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xff7a1a }),
      ),
    );
    g.add(
      new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.PointsMaterial({ color: 0xff7a1a, size: 8, sizeAttenuation: false }),
      ),
    );
    ctx.three.add(g);
    ctx.draft = g;
  }, [draw]);

  // 슬라이스 컬러맵 평면
  const { slice, showSlice, minDb } = props;
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.slice) {
      ctx.three.remove(ctx.slice);
      ctx.slice.geometry.dispose();
      const m = ctx.slice.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
      ctx.slice = null;
    }
    if (!slice || !showSlice) return;
    const data = new Uint8Array(slice.nx * slice.ny * 4);
    for (let i = 0; i < slice.levels.length; i++) {
      const db = slice.levels[i]!;
      const blocked = db === Number.NEGATIVE_INFINITY; // 가려진 셀은 투명 (실제 레벨이 아님)
      const c = colormap(levelToT(db, minDb));
      data.set([c[0], c[1], c[2], blocked ? 0 : 215], i * 4);
    }
    const tex = new THREE.DataTexture(data, slice.nx, slice.ny, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    const w = slice.nx * slice.cell;
    const h = slice.ny * slice.cell;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.position.set(slice.x0 + w / 2, slice.y0 + h / 2, slice.z);
    ctx.three.add(mesh);
    ctx.slice = mesh;
  }, [slice, showSlice, minDb]);

  // 파면 버퍼 (모델이 바뀔 때만 다시 할당)
  const models = props.waves.map((w) => w.model);
  const modelKey = models.map((m) => `${m.src.join(',')}:${m.n}:${m.maxSeg}:${m.rMax}`).join('|');
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    for (const w of ctx.waves) {
      ctx.three.remove(w.points, w.mesh);
      w.points.geometry.dispose();
      w.mesh.geometry.dispose();
      (w.points.material as THREE.Material).dispose();
      (w.mesh.material as THREE.Material).dispose();
    }
    ctx.waves = models.map((model) => {
      const frame = makeWaveFrame(model.n);
      const pos = new Float32Array(model.n * 3);
      const col = new Float32Array(model.n * 3);
      const dyn = (a: Float32Array) =>
        new THREE.BufferAttribute(a, 3).setUsage(THREE.DynamicDrawUsage);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', dyn(pos));
      pg.setAttribute('color', dyn(col));
      pg.setDrawRange(0, 0);
      const points = new THREE.Points(
        pg,
        new THREE.PointsMaterial({
          size: 3.5,
          sizeAttenuation: false,
          vertexColors: true,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      points.frustumCulled = false;
      const idx = new Uint32Array(model.faces.length);
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', dyn(frame.positions));
      mg.setAttribute('color', dyn(frame.colors));
      mg.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
      mg.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(
        mg,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      mesh.frustumCulled = false;
      ctx.three.add(points, mesh);
      return { points, mesh, frame, pos, col, idx, model };
    });
    ctx.dirty = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey]);

  // 표시 옵션이 바뀌면 파면을 다시 채운다
  useEffect(() => {
    if (ctxRef.current) ctxRef.current.dirty = true;
  }, [props.waves, props.minDb, props.showWave]);

  return (
    <div className="viewport" ref={hostRef}>
      {error ? <div className="viewport-error">{error}</div> : null}
      <button type="button" className="fit-btn" onClick={fitView}>
        화면 맞춤
      </button>
      <div className="viewport-hint">
        {props.draw.active
          ? '클릭: 폴리라인 점 추가 · '
          : '클릭 선택 · 본체 드래그: 수평 이동 (Shift: 수직) · 기즈모: 이동/회전/크기 · '}
        좌 드래그 회전 · 우 드래그 이동 · 휠 확대/축소 · 단위 m, Z-up
      </div>
    </div>
  );
});

/** 클릭한 삼각형·점에서 꼭짓점/모서리/면 선택을 만든다. additive(Shift)면 기존 선택에 더한다. */
function pickSub(
  base: import('../types').MeshSurface,
  objectId: string,
  level: Exclude<EditLevel, 'object'>,
  tri: number,
  lp: Vec3,
  prev: SubSel | null,
  additive: boolean,
): SubSel {
  const w = getWeld(base);
  const t3: number[] = [0, 1, 2].map((k) => w.groupOf[base.indices[tri * 3 + k]!]!);
  let groups: number[] = [];
  let edges: [number, number][] = [];
  let tris: number[] = [];
  if (level === 'vertex') {
    let best = t3[0]!;
    let bd = Infinity;
    for (const g of t3) {
      const q = groupPos(base, w, g);
      const d = Math.hypot(q[0] - lp[0], q[1] - lp[1], q[2] - lp[2]);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    groups = [best];
  } else if (level === 'edge') {
    const e = nearestEdge(base, w, tri, lp);
    edges = [e];
    groups = [...e];
  } else {
    tris = faceTriangles(base, w, tri);
    groups = groupsOfTriangles(base, w, tris);
  }
  if (additive && prev && prev.objectId === objectId && prev.level === level) {
    if (level === 'vertex' && prev.groups.includes(groups[0]!)) {
      groups = prev.groups.filter((g) => g !== groups[0]); // 이미 선택된 꼭짓점은 해제
    } else {
      groups = [...new Set([...prev.groups, ...groups])];
    }
    edges = [...prev.edges, ...edges];
    tris = [...new Set([...prev.tris, ...tris])];
  }
  return { objectId, level, groups, edges, tris };
}
