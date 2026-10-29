import { FACE_LABELS } from '../geometry/domain';
import { ROLE_LABELS } from '../editor/materials';
import {
  duplicateObject,
  removeObject,
  removeReceiver,
  removeSource,
  setMaterialBand,
  setEmitter,
  setRole,
  setTransform,
  updateObject,
  updateReceiver,
  updateSource,
} from '../editor/ops';
import type { EditorState, ObjectRole } from '../editor/types';
import { FACE_IDS, type Domain, type FaceId, type Material, type Vec3 } from '../types';
import type { Selection } from '../visualization/editLayer';
import { BandInputs, Help, PosInput, TlInputs } from './fields';

export interface InspectorProps {
  state: EditorState;
  selection: Selection | null;
  onChange: (s: EditorState) => void;
  onSelect: (s: Selection | null) => void;
  domainMaterials: Material[]; // 영역 반사 면에 고를 수 있는 재료
}

const ROLES: ObjectRole[] = ['reflect', 'absorber', 'obstacle', 'open', 'custom'];

/** 선택한 대상의 속성 패널. 숫자 입력과 3D 기즈모는 같은 상태를 편집한다. */
export function Inspector({
  state,
  selection,
  onChange,
  onSelect,
  domainMaterials,
}: InspectorProps) {
  if (!selection)
    return <div className="muted">3D 화면이나 목록에서 대상을 선택하면 속성이 표시됩니다.</div>;

  if (selection.kind === 'object') {
    const o = state.objects.find((x) => x.id === selection.id);
    if (!o) return null;
    const t = o.transform;
    return (
      <div className="inspector">
        <label className="field">
          이름
          <input
            type="text"
            value={o.name}
            onChange={(e) => onChange(updateObject(state, o.id, { name: e.target.value }))}
          />
        </label>
        {o.emitter ? (
          <>
            <BandInputs
              label="면 전체 파워 레벨 Lw [dB re 1 pW]"
              value={o.emitter.lw}
              step={1}
              onChange={(b, v) =>
                onChange(setEmitter(state, o.id, { lw: { ...o.emitter!.lw, [b]: v } }))
              }
            />
            <div className="grid3">
              <label className="field">
                표본점 가로
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={o.emitter.nu}
                  onChange={(e) =>
                    onChange(setEmitter(state, o.id, { nu: Number(e.target.value) }))
                  }
                />
              </label>
              <label className="field">
                표본점 세로
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={o.emitter.nv}
                  onChange={(e) =>
                    onChange(setEmitter(state, o.id, { nv: Number(e.target.value) }))
                  }
                />
              </label>
            </div>
            <div className="muted">
              면을 {o.emitter.nu}×{o.emitter.nv} = {o.emitter.nu * o.emitter.nv}개 표본점으로 나눠
              각 점에 파워를 균등 분할합니다 (점당 Lw −
              {(10 * Math.log10(o.emitter.nu * o.emitter.nv)).toFixed(1)} dB). 점은 전방위로
              방사하는 비간섭 점음원이고, 면 자체는 소리를 막거나 반사하지 않습니다.
            </div>
          </>
        ) : (
          <>
            <label className="field">
              역할 (프리셋) <Help anchor="#reflection" label="재료 흡음률과 산란" />
              <select
                value={o.role}
                onChange={(e) => onChange(setRole(state, o.id, e.target.value as ObjectRole))}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <BandInputs
              label="흡음률 α (0~1)"
              value={o.material.absorption}
              min={0}
              max={1}
              onChange={(b, v) => onChange(setMaterialBand(state, o.id, 'absorption', b, v))}
            />
            <BandInputs
              label="산란 계수 s (0~1)"
              value={o.material.scattering}
              min={0}
              max={1}
              onChange={(b, v) => onChange(setMaterialBand(state, o.id, 'scattering', b, v))}
            />
            <TlInputs
              label="투과손실 TL [dB] (비우면 투과 없음, 음원 쪽 면에서 통과한 에너지 τ = 10^(−TL/10))"
              value={o.material.transmission}
              onChange={(b, v) => onChange(setMaterialBand(state, o.id, 'transmission', b, v))}
            />
            <div className="muted">
              프리셋 값은 예시이며 실측 데이터가 아닙니다. α + τ ≤ 1 이며 나머지가 반사됩니다.
              투과는 직접음과 확산(몬테카를로)에만 반영되고, 이미지 음원 반사 경로는 투과 면에
              가려진 것으로 처리합니다.
            </div>
          </>
        )}
        <PosInput
          label="위치 [m]"
          value={t.position}
          onChange={(v) => onChange(setTransform(state, o.id, { ...t, position: v }))}
        />
        <PosInput
          label="회전 [°]"
          value={t.rotationDeg}
          step={5}
          onChange={(v) => onChange(setTransform(state, o.id, { ...t, rotationDeg: v }))}
        />
        <PosInput
          label="크기 배율"
          value={t.scale}
          onChange={(v) => onChange(setTransform(state, o.id, { ...t, scale: v }))}
        />
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              const r = duplicateObject(state, o.id);
              if (r) {
                onChange(r.state);
                onSelect({ kind: 'object', id: r.id });
              }
            }}
          >
            복제
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              onChange(removeObject(state, o.id));
              onSelect(null);
            }}
          >
            삭제
          </button>
        </div>
      </div>
    );
  }

  if (selection.kind === 'source') {
    const s = state.sources.find((x) => x.id === selection.id);
    if (!s) return null;
    return (
      <div className="inspector">
        <label className="field">
          이름
          <input
            type="text"
            value={s.name}
            onChange={(e) => onChange(updateSource(state, s.id, { name: e.target.value }))}
          />
        </label>
        <PosInput
          label="위치 [m]"
          value={s.position}
          onChange={(v) => onChange(updateSource(state, s.id, { position: v }))}
        />
        <BandInputs
          label="파워 레벨 Lw [dB re 1 pW]"
          value={s.lw}
          step={1}
          onChange={(b, v) => onChange(updateSource(state, s.id, { lw: { ...s.lw, [b]: v } }))}
        />
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            onChange(removeSource(state, s.id));
            onSelect(null);
          }}
        >
          삭제
        </button>
      </div>
    );
  }

  if (selection.kind === 'receiver') {
    const r = state.receivers.find((x) => x.id === selection.id);
    if (!r) return null;
    return (
      <div className="inspector">
        <label className="field">
          이름
          <input
            type="text"
            value={r.name}
            onChange={(e) => onChange(updateReceiver(state, r.id, { name: e.target.value }))}
          />
        </label>
        <PosInput
          label="위치 [m]"
          value={r.position}
          onChange={(v) => onChange(updateReceiver(state, r.id, { position: v }))}
        />
        <label className="field">
          수신 구 반경 [m]
          <input
            type="number"
            step={0.1}
            min={0.05}
            value={r.radius}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) onChange(updateReceiver(state, r.id, { radius: v }));
            }}
          />
        </label>
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            onChange(removeReceiver(state, r.id));
            onSelect(null);
          }}
        >
          삭제
        </button>
      </div>
    );
  }

  return <DomainInspector state={state} onChange={onChange} materials={domainMaterials} />;
}

function DomainInspector({
  state,
  onChange,
  materials,
}: {
  state: EditorState;
  onChange: (s: EditorState) => void;
  materials: Material[];
}) {
  const d = state.domain;
  const setD = (next: Domain) => onChange({ ...state, domain: next });
  const size: Vec3 = [d.max[0] - d.min[0], d.max[1] - d.min[1], d.max[2] - d.min[2]];
  return (
    <div className="inspector">
      <div className="muted">
        해석 영역 (박스 룸) <Help anchor="#domain" label="해석 영역과 경계 조건" />
      </div>
      <PosInput
        label="최소 모서리"
        value={d.min}
        onChange={(v) =>
          setD({ ...d, min: v, max: [v[0] + size[0], v[1] + size[1], v[2] + size[2]] })
        }
      />
      <PosInput
        label="크기 [m]"
        value={size}
        onChange={(v) => {
          if (v.every((x) => x >= 0.5))
            setD({ ...d, max: [d.min[0] + v[0], d.min[1] + v[1], d.min[2] + v[2]] });
        }}
      />
      <table className="bands faces">
        <thead>
          <tr>
            <th>면</th>
            <th>경계 조건</th>
            <th>재료</th>
          </tr>
        </thead>
        <tbody>
          {FACE_IDS.map((f: FaceId) => {
            const face = d.faces[f];
            const setFace = (patch: Partial<typeof face>) =>
              setD({ ...d, faces: { ...d.faces, [f]: { ...face, ...patch } } });
            return (
              <tr key={f}>
                <td className="name">{FACE_LABELS[f]}</td>
                <td>
                  <select
                    value={face.type}
                    aria-label={`${FACE_LABELS[f]} 경계 조건`}
                    onChange={(e) => setFace({ type: e.target.value as 'reflect' | 'open' })}
                  >
                    <option value="reflect">반사 (실내)</option>
                    <option value="open">소산 (열림)</option>
                  </select>
                </td>
                <td>
                  <select
                    value={face.materialId}
                    disabled={face.type === 'open'}
                    aria-label={`${FACE_LABELS[f]} 재료`}
                    onChange={(e) => setFace({ materialId: e.target.value })}
                  >
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted">소산 면은 흡음률 1로 취급하며, 나간 광선은 사라집니다.</div>
    </div>
  );
}
