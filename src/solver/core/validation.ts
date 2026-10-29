import { BAND_CENTERS, FACE_IDS, SCENE_SCHEMA_VERSION, type Scene, type Vec3 } from '../../types';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string; // 기계가 읽는 코드
  message: string; // 사용자에게 보이는 설명
}

/** 퇴화 삼각형으로 보는 면적 하한 [m²]. */
const DEGENERATE_AREA_M2 = 1e-12;

const finite3 = (v: Vec3) => v.every(Number.isFinite);

function duplicateIds(items: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const it of items) (seen.has(it.id) ? dup : seen).add(it.id);
  return [...dup];
}

/** 장면 입력을 검증한다. error가 있으면 계산에 쓰면 안 된다. */
export function validateScene(scene: Scene): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string) => issues.push({ severity: 'error', code, message });
  const warn = (code: string, message: string) =>
    issues.push({ severity: 'warning', code, message });

  if (scene.schemaVersion !== SCENE_SCHEMA_VERSION)
    err('schema-version', `장면 형식 버전이 다릅니다 (${scene.schemaVersion}).`);
  if (scene.units !== 'm') err('units', '장면 내부 단위는 m여야 합니다.');

  for (const [label, items] of [
    ['메시', scene.meshes],
    ['재료', scene.materials],
    ['음원', scene.sources],
    ['수신기', scene.receivers],
  ] as const) {
    for (const id of duplicateIds(items)) err('duplicate-id', `${label} id가 중복됩니다: ${id}`);
  }

  const materialIds = new Set(scene.materials.map((m) => m.id));
  const usedMaterialIds = new Set(scene.meshes.map((m) => m.materialId)); // 실제 사용 중인 재료

  // 해석 영역: 크기와 면별 경계 조건
  const dom = scene.domain;
  if (!finite3(dom.min) || !finite3(dom.max) || dom.min.some((v, i) => dom.max[i]! - v <= 0)) {
    err(
      'domain-size',
      '해석 영역의 최소·최대 모서리가 유효하지 않습니다 (모든 축에서 최대 > 최소).',
    );
  }
  for (const f of FACE_IDS) {
    const face = dom.faces[f];
    if (face.type === 'reflect') {
      usedMaterialIds.add(face.materialId);
      if (!materialIds.has(face.materialId))
        err('domain-material', `영역 ${f} 면이 없는 재료(${face.materialId})를 참조합니다.`);
    }
  }

  for (const m of scene.materials) {
    for (const fc of BAND_CENTERS) {
      for (const [key, v] of [
        ['흡음률 α', m.absorption[fc]],
        ['산란 계수 s', m.scattering[fc]],
        ['투과율 τ', m.transmission?.[fc] ?? 0],
      ] as const) {
        if (!Number.isFinite(v) || v < 0 || v > 1)
          err('material-range', `재료 ${m.id}의 ${key}(${fc} Hz)가 0~1 범위를 벗어났습니다.`);
      }
    }
    for (const fc of BAND_CENTERS) {
      if (m.absorption[fc] + (m.transmission?.[fc] ?? 0) > 1 + 1e-9)
        err('material-energy', `재료 ${m.id}의 α + τ(${fc} Hz)가 1을 넘습니다.`);
    }
    if (m.isExample && usedMaterialIds.has(m.id))
      warn('material-example', `사용 중인 재료 "${m.name}"는 예시 값입니다 (실측 데이터 아님).`);
  }

  for (const mesh of scene.meshes) {
    const p = mesh.positions;
    const idx = mesh.indices;
    if (p.length % 3 !== 0 || idx.length % 3 !== 0) {
      err('mesh-size', `메시 ${mesh.id}의 좌표/인덱스 길이가 3의 배수가 아닙니다.`);
      continue;
    }
    if (!p.every(Number.isFinite))
      err('mesh-nonfinite', `메시 ${mesh.id}에 NaN/Infinity가 있습니다.`);
    const vertexCount = p.length / 3;
    if (idx.some((i) => i >= vertexCount))
      err('mesh-index', `메시 ${mesh.id}에 범위를 벗어난 인덱스가 있습니다.`);
    if (!materialIds.has(mesh.materialId))
      err('mesh-material', `메시 ${mesh.id}가 없는 재료(${mesh.materialId})를 참조합니다.`);

    // 퇴화 삼각형 수 (인덱스가 유효할 때만)
    if (!idx.some((i) => i >= vertexCount)) {
      let degenerate = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const a = (idx[t] as number) * 3;
        const b = (idx[t + 1] as number) * 3;
        const c = (idx[t + 2] as number) * 3;
        const e1 = [0, 1, 2].map((k) => (p[b + k] as number) - (p[a + k] as number)) as [
          number,
          number,
          number,
        ];
        const e2 = [0, 1, 2].map((k) => (p[c + k] as number) - (p[a + k] as number)) as [
          number,
          number,
          number,
        ];
        const cx = e1[1] * e2[2] - e1[2] * e2[1];
        const cy = e1[2] * e2[0] - e1[0] * e2[2];
        const cz = e1[0] * e2[1] - e1[1] * e2[0];
        if (0.5 * Math.hypot(cx, cy, cz) < DEGENERATE_AREA_M2) degenerate++;
      }
      if (degenerate > 0)
        warn('mesh-degenerate', `메시 ${mesh.id}에 퇴화 삼각형이 ${degenerate}개 있습니다.`);
    }
  }

  const inDomain = (p: Vec3) => p.every((v, i) => v >= dom.min[i]! && v <= dom.max[i]!);
  const meshIds = new Set(scene.meshes.map((m) => m.id));
  for (const s of scene.sources) {
    for (const fc of BAND_CENTERS)
      if (!Number.isFinite(s.lw[fc]))
        err('source-lw', `음원 ${s.id}의 Lw(${fc} Hz)가 유한하지 않습니다.`);
    if (s.kind === 'point' && !finite3(s.position))
      err('source-position', `음원 ${s.id}의 위치가 유효하지 않습니다.`);
    else if (s.kind === 'point' && !inDomain(s.position))
      err('source-outside', `음원 ${s.id}가 해석 영역 밖에 있습니다.`);
    if (s.kind === 'area') {
      if (!meshIds.has(s.meshId))
        err('source-mesh', `면음원 ${s.id}가 없는 메시(${s.meshId})를 참조합니다.`);
      warn('source-area-unsupported', `면음원 ${s.id}는 STEP 5 전까지 계산에 사용되지 않습니다.`);
    }
  }
  if (scene.sources.length === 0) warn('no-source', '음원이 없습니다.');

  for (const r of scene.receivers) {
    if (!finite3(r.position))
      err('receiver-position', `수신기 ${r.id}의 위치가 유효하지 않습니다.`);
    else if (!inDomain(r.position))
      warn('receiver-outside', `수신기 ${r.id}가 해석 영역 밖에 있습니다 (계산에서 제외).`);
    if (!Number.isFinite(r.radius) || r.radius <= 0)
      err('receiver-radius', `수신기 ${r.id}의 반경은 0보다 커야 합니다.`);
  }

  return issues;
}

export const hasErrors = (issues: readonly ValidationIssue[]): boolean =>
  issues.some((i) => i.severity === 'error');
