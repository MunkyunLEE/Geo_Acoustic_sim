import { BAND_CENTERS, type PerBand } from '../types';

export interface ResultRow {
  name: string; // 수신점 이름
  distance: number; // 거리 [m]
  delayMs: number; // 직접음 도달 지연 [ms]
  visible: boolean; // 가시선
  bandDb: PerBand<number>; // 밴드별 상대 레벨 [dB]
  totalDb: number; // 선택 레벨의 합 [dB]
  directDb: number; // 직접음 성분 [dB]
  reflDb: number; // 반사음 성분 [dB]
  diffDb: number; // 회절음 성분 [dB]
  scatDb: number; // 확산(몬테카를로) 성분 [dB]
  scatSeDb: number; // 확산 성분 표준오차 [dB] (없으면 NaN)
  nRefl: number; // 유효한 반사 경로 수
  nDiff: number; // 회절 경로 수
}

const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—');

/** 수신점별 직접음 결과 표. 가려진 수신점은 직접음 없음(—)으로 표시한다. */
export function ResultsPanel({ rows }: { rows: ResultRow[] }) {
  return (
    <div>
      <div className="notice">
        <strong>미검증 프리뷰.</strong> 직접음 + 정반사(이미지 음원) + 차폐 보정 회절 + 확산
        반사(몬테카를로, 설정에서 켠 경우)의 에너지 합(비간섭, 근사)입니다. 반사 경로의 회절은
        포함하지 않습니다. 값은 음원 대비 상대 레벨(자유장 1 m = 0 dB)입니다.
      </div>
      <table className="bands results">
        <thead>
          <tr>
            <th>수신점</th>
            <th>거리 m</th>
            <th>지연 ms</th>
            {BAND_CENTERS.map((f) => (
              <th key={f}>{f}</th>
            ))}
            <th>합계</th>
            <th>직접</th>
            <th>반사</th>
            <th>회절</th>
            <th>확산 ±SE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="name">
                {r.name}
                {r.visible ? '' : ' (가려짐)'}
              </td>
              <td>{r.distance.toFixed(2)}</td>
              <td>{r.delayMs.toFixed(2)}</td>
              {BAND_CENTERS.map((f) => (
                <td key={f}>{f1(r.bandDb[f])}</td>
              ))}
              <td>
                <strong>{f1(r.totalDb)}</strong>
              </td>
              <td>{f1(r.directDb)}</td>
              <td title={`유효 경로 ${r.nRefl}개`}>{f1(r.reflDb)}</td>
              <td title={`경로 ${r.nDiff}개`}>{f1(r.diffDb)}</td>
              <td title="몬테카를로 배치 표준오차 (근사)">
                {f1(r.scatDb)}
                {Number.isFinite(r.scatSeDb) ? ` ±${r.scatSeDb.toFixed(1)}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted">
        밴드: 중심 주파수 [Hz], 값: 상대 레벨 [dB]. 성분 열은 선택한 표시 레벨 기준이며 "—"은 해당
        성분 없음. 지연 = 직선 거리 / 음속.
      </div>
    </div>
  );
}
