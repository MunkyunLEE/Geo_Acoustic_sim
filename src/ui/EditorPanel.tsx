import { useRef, useState } from 'react';
import type { EditLevel } from '../visualization/subLayer';
import { ROLE_LABELS } from '../editor/materials';
import type { PrimitiveKind } from '../editor/ops';
import type { Pt2 } from '../editor/shapes';
import type { EditorState, ObjectRole } from '../editor/types';
import { importMeshFile } from '../io/meshImport';
import type { LengthUnit, MeshSurface } from '../types';
import type { Selection } from '../visualization/editLayer';
import { Help } from './fields';
import type { GizmoMode } from './Viewport';

/** 폴리라인 그리기 도구 상태. */
export interface DrawState {
  active: boolean; // 그리는 중
  points: Pt2[]; // 찍은 점
  z: number; // 그리는 높이 [m]
  height: number; // extrude 높이 [m]
  closed: boolean; // 닫힌 폴리라인
  capBottom: boolean;
  capTop: boolean;
  asFace: boolean; // extrude 없이 면 한 장
  role: ObjectRole;
}

export const INITIAL_DRAW: DrawState = {
  active: false,
  points: [],
  z: 0,
  height: 3,
  closed: false,
  capBottom: false,
  capTop: false,
  asFace: false,
  role: 'reflect',
};

export interface EditorPanelProps {
  state: EditorState;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  editLevel: EditLevel;
  onEditLevel: (l: EditLevel) => void;
  subCount: number; // 선택된 꼭짓점 수 (하위 요소 편집)
  gizmoMode: GizmoMode;
  onGizmoMode: (m: GizmoMode) => void;
  snap: { on: boolean; step: number };
  onSnap: (s: { on: boolean; step: number }) => void;
  draw: DrawState;
  onDraw: (d: DrawState) => void;
  onFinishDraw: () => void;
  onAdd: (kind: PrimitiveKind) => void;
  onAddSource: () => void;
  onAddReceiver: () => void;
  onImport: (mesh: MeshSurface, role: ObjectRole, warnings: string[]) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
}

const ROLES: ObjectRole[] = ['reflect', 'absorber', 'obstacle', 'open'];
const LEVELS: [EditLevel, string][] = [
  ['object', '객체'],
  ['vertex', '꼭짓점'],
  ['edge', '모서리'],
  ['face', '면'],
];
const MODES: [GizmoMode, string][] = [
  ['translate', '이동'],
  ['rotate', '회전'],
  ['scale', '크기'],
];

/** 만들기·가져오기·객체 목록·기즈모 도구. 속성 편집은 Inspector. */
export function EditorPanel(p: EditorPanelProps) {
  const [unit, setUnit] = useState<LengthUnit>('m');
  const [yUp, setYUp] = useState(false);
  const [impRole, setImpRole] = useState<ObjectRole>('reflect');
  const [msg, setMsg] = useState<{ kind: 'err' | 'warn' | 'ok'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef<HTMLInputElement>(null);
  const d = p.draw;
  const setD = (patch: Partial<DrawState>) => p.onDraw({ ...d, ...patch });
  const isSel = (kind: Selection['kind'], id: string) =>
    p.selection?.kind === kind && p.selection.id === id;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await importMeshFile(file, { unit, yUp, materialId: 'ex-reflective' });
      p.onImport(r.mesh, impRole, r.warnings);
      setMsg(
        r.warnings.length
          ? { kind: 'warn', text: r.warnings.join(' ') }
          : {
              kind: 'ok',
              text: `${file.name}: 삼각형 ${r.mesh.indices.length / 3}개를 불러왔습니다.`,
            },
      );
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '불러오기에 실패했습니다.' });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="controls">
      <details open>
        <summary>
          STL / OBJ 가져오기 <Help anchor="#units" label="좌표계와 단위" />
        </summary>
        <div className="row">
          <label className="field inline">
            단위
            <select value={unit} onChange={(e) => setUnit(e.target.value as LengthUnit)}>
              <option value="m">m</option>
              <option value="cm">cm</option>
              <option value="mm">mm</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={yUp} onChange={(e) => setYUp(e.target.checked)} /> Y-up
            파일
          </label>
          <label className="field inline">
            역할
            <select value={impRole} onChange={(e) => setImpRole(e.target.value as ObjectRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".stl,.obj"
          aria-label="STL 또는 OBJ 파일"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <div className="muted">
          서페이스(열린 면)도 그대로 받습니다. 닫힌 솔리드일 필요가 없습니다.
        </div>
        {msg ? (
          <div className={msg.kind === 'err' ? 'err' : msg.kind === 'ok' ? 'ok' : 'notice'}>
            {msg.text}
          </div>
        ) : null}
      </details>

      <details open>
        <summary>만들기</summary>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => p.onAdd('box')}>
            박스
          </button>
          <button type="button" className="btn" onClick={() => p.onAdd('plane')}>
            평면(벽)
          </button>
          <button type="button" className="btn" onClick={() => p.onAdd('cylinder')}>
            원기둥
          </button>
          <button type="button" className="btn" onClick={() => p.onAdd('open-cylinder')}>
            원통(열림)
          </button>
          <button type="button" className="btn" onClick={p.onAddSource}>
            ＋ 음원
          </button>
          <button type="button" className="btn" onClick={() => p.onAdd('area-source')}>
            ＋ 면음원
          </button>
          <button type="button" className="btn" onClick={p.onAddReceiver}>
            ＋ 수신점
          </button>
          <button
            type="button"
            className={d.active ? 'btn primary' : 'btn'}
            onClick={() => p.onDraw({ ...d, active: !d.active, points: [] })}
          >
            ✎ 폴리라인
          </button>
        </div>
        {d.active ? (
          <div className="draw-box">
            <div className="muted">
              3D 화면을 클릭해 점을 찍습니다 (높이 z 평면, 스냅 적용). 점 {d.points.length}개
            </div>
            <label className="field">
              그리는 높이 z [m]
              <input
                type="number"
                step={0.5}
                value={d.z}
                onChange={(e) => setD({ z: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={d.closed}
                onChange={(e) => setD({ closed: e.target.checked })}
              />{' '}
              닫힌 폴리라인
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={d.asFace}
                onChange={(e) =>
                  setD({ asFace: e.target.checked, closed: e.target.checked || d.closed })
                }
              />{' '}
              extrude 없이 면 한 장으로
            </label>
            {!d.asFace ? (
              <>
                <label className="field">
                  extrude 높이 [m]
                  <input
                    type="number"
                    step={0.5}
                    min={0.1}
                    value={d.height}
                    onChange={(e) => setD({ height: Number(e.target.value) })}
                  />
                </label>
                {d.closed ? (
                  <div className="row">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={d.capBottom}
                        onChange={(e) => setD({ capBottom: e.target.checked })}
                      />{' '}
                      바닥면
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={d.capTop}
                        onChange={(e) => setD({ capTop: e.target.checked })}
                      />{' '}
                      윗면
                    </label>
                  </div>
                ) : null}
              </>
            ) : null}
            <label className="field">
              역할
              <select value={d.role} onChange={(e) => setD({ role: e.target.value as ObjectRole })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <button type="button" className="btn primary" onClick={p.onFinishDraw}>
                완료
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setD({ points: d.points.slice(0, -1) })}
              >
                마지막 점 취소
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => p.onDraw({ ...d, active: false, points: [] })}
              >
                그리기 종료
              </button>
            </div>
          </div>
        ) : null}
      </details>

      <details open>
        <summary>
          장면 구성 ({p.state.objects.length + p.state.sources.length + p.state.receivers.length}개)
        </summary>
        <ul className="objlist">
          <li
            className={isSel('domain', 'domain') ? 'sel' : ''}
            onClick={() => p.onSelect({ kind: 'domain', id: 'domain' })}
          >
            ▢ 해석 영역 (박스 룸)
          </li>
          {p.state.objects.map((o) => (
            <li
              key={o.id}
              className={isSel('object', o.id) ? 'sel' : ''}
              onClick={() => p.onSelect({ kind: 'object', id: o.id })}
            >
              ◼ {o.name} <span className="muted">({ROLE_LABELS[o.role]})</span>
            </li>
          ))}
          {p.state.sources.map((s) => (
            <li
              key={s.id}
              className={isSel('source', s.id) ? 'sel' : ''}
              onClick={() => p.onSelect({ kind: 'source', id: s.id })}
            >
              ● {s.name} <span className="muted">(음원)</span>
            </li>
          ))}
          {p.state.receivers.map((r) => (
            <li
              key={r.id}
              className={isSel('receiver', r.id) ? 'sel' : ''}
              onClick={() => p.onSelect({ kind: 'receiver', id: r.id })}
            >
              ○ {r.name} <span className="muted">(수신점)</span>
            </li>
          ))}
        </ul>
      </details>

      <details open>
        <summary>편집 도구</summary>
        <div className="row">
          {LEVELS.map(([l, label]) => (
            <button
              key={l}
              type="button"
              className={p.editLevel === l ? 'btn primary' : 'btn'}
              disabled={l !== 'object' && p.selection?.kind !== 'object'}
              title={
                l === 'object'
                  ? '객체 전체 이동·회전·크기'
                  : '객체를 먼저 선택한 뒤 하위 요소를 클릭'
              }
              onClick={() => p.onEditLevel(l)}
            >
              {label}
            </button>
          ))}
        </div>
        {p.editLevel !== 'object' ? (
          <div className="muted">
            {p.editLevel === 'vertex' ? '꼭짓점' : p.editLevel === 'edge' ? '모서리' : '면'}을
            클릭해 선택(Shift: 추가)하고 기즈모로 끌어 당기거나 밀어 넣습니다. 같은 위치의 꼭짓점은
            함께 움직입니다. <strong data-testid="sub-count">선택된 꼭짓점 {p.subCount}개</strong>
          </div>
        ) : null}
        <div className="row">
          {MODES.map(([m, label]) => (
            <button
              key={m}
              type="button"
              className={p.gizmoMode === m ? 'btn primary' : 'btn'}
              onClick={() => p.onGizmoMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={p.snap.on}
              onChange={(e) => p.onSnap({ ...p.snap, on: e.target.checked })}
            />{' '}
            그리드 스냅
          </label>
          <label className="field inline">
            간격 [m]
            <input
              type="number"
              step={0.25}
              min={0.05}
              value={p.snap.step}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) p.onSnap({ ...p.snap, step: v });
              }}
            />
          </label>
        </div>
        <div className="muted">
          스냅이 켜지면 이동은 간격, 회전은 15°, 크기는 0.1 단위입니다. 음원·수신점은 이동만 됩니다.
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={p.onSave}>
            장면 저장 (JSON)
          </button>
          <button type="button" className="btn" onClick={() => loadRef.current?.click()}>
            장면 불러오기
          </button>
          <input
            ref={loadRef}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onLoad(f);
              e.target.value = '';
            }}
          />
        </div>
      </details>
    </div>
  );
}
