import { docsUrl } from '../app/docsUrl';
import { boundingBox, triangleCount } from '../geometry/primitives';
import { hasErrors, type ValidationIssue } from '../solver/core/validation';
import { BAND_CENTERS, type Scene } from '../types';

/** 물리 문서의 해당 장으로 가는 ⓘ 링크. */
function Help({ anchor, label }: { anchor: string; label: string }) {
  return (
    <a
      className="help"
      href={docsUrl('physics', anchor)}
      target="_blank"
      rel="noopener"
      title={label}
    >
      ⓘ
    </a>
  );
}

const fmt = (v: number) => v.toFixed(2);

export function InfoPanel({ scene, issues }: { scene: Scene; issues: ValidationIssue[] }) {
  const tris = scene.meshes.reduce((n, m) => n + triangleCount(m), 0);
  const box = boundingBox(scene.meshes);
  const size = box ? box.max.map((v, i) => v - (box.min[i] as number)) : null;

  return (
    <div className="info">
      <h3>장면</h3>
      <table>
        <tbody>
          <tr>
            <th>이름</th>
            <td>{scene.name}</td>
          </tr>
          <tr>
            <th>메시</th>
            <td>
              {scene.meshes.length}개 · 삼각형 {tris}개
            </td>
          </tr>
          <tr>
            <th>크기 [m]</th>
            <td>
              {size
                ? `${fmt(size[0] as number)} × ${fmt(size[1] as number)} × ${fmt(size[2] as number)}`
                : '메시 없음'}
            </td>
          </tr>
          <tr>
            <th>
              좌표계 <Help anchor="#units" label="좌표계와 단위" />
            </th>
            <td>Z-up 우수 좌표계, 단위 m</td>
          </tr>
        </tbody>
      </table>

      <h3>
        음원 <Help anchor="#source" label="점음원과 상대 레벨" />
      </h3>
      {scene.sources.map((s) => (
        <div key={s.id} className="block">
          <div>
            {s.name} ({s.kind === 'point' ? '점음원' : '면음원'}
            {s.kind === 'point' ? `, [${s.position.join(', ')}] m` : ''})
          </div>
          <table className="bands">
            <thead>
              <tr>
                {BAND_CENTERS.map((f) => (
                  <th key={f}>{f}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {BAND_CENTERS.map((f) => (
                  <td key={f}>{s.lw[f]}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <div className="muted">밴드별 파워 레벨 Lw [dB re 1 pW], 중심 주파수 [Hz]</div>
        </div>
      ))}

      <h3>
        수신점 <Help anchor="#receiver" label="수신기 추정자" />
      </h3>
      <ul>
        {scene.receivers.map((r) => (
          <li key={r.id}>
            {r.name}: [{r.position.join(', ')}] m, 수신 구 반경 {r.radius} m
          </li>
        ))}
      </ul>

      <h3>재료 (예시 값)</h3>
      <ul>
        {scene.materials.map((m) => (
          <li key={m.id}>{m.name}</li>
        ))}
      </ul>

      <h3>입력 검증</h3>
      {issues.length === 0 ? (
        <div className="ok">문제가 없습니다.</div>
      ) : (
        <ul className="issues">
          {issues.map((i, k) => (
            <li key={k} className={i.severity}>
              {i.severity === 'error' ? '오류' : '경고'}: {i.message}
            </li>
          ))}
        </ul>
      )}
      {hasErrors(issues) ? <div className="err">오류가 있어 계산에 사용할 수 없습니다.</div> : null}
    </div>
  );
}
