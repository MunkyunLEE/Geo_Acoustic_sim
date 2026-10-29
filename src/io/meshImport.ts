import type { LengthUnit, MeshSurface } from '../types';
import { convertPositionsToMeters } from '../solver/core/units';

/** 파싱 직후의 원본 단위 메시 (용접 완료). */
export interface RawMesh {
  positions: Float32Array; // [x,y,z,...] 원본 단위
  indices: Uint32Array; // 삼각형 인덱스
}

export interface ImportOptions {
  unit: LengthUnit; // 파일의 길이 단위
  yUp: boolean; // true면 Y-up 파일을 Z-up으로 변환 (Rhino 기본은 Z-up)
  materialId: string; // 할당할 재료
  name: string; // 메시 이름
}

export interface ImportResult {
  mesh: MeshSurface;
  warnings: string[];
}

/** 같은 위치 정점을 합친다 (STL은 삼각형마다 정점이 중복됨). 퇴화 삼각형은 제거한다. */
function weld(tri: Float32Array): RawMesh {
  const map = new Map<string, number>();
  const pos: number[] = [];
  const idx: number[] = [];
  for (let t = 0; t < tri.length; t += 9) {
    const ids: number[] = [];
    for (let k = 0; k < 3; k++) {
      const x = tri[t + k * 3]!,
        y = tri[t + k * 3 + 1]!,
        z = tri[t + k * 3 + 2]!;
      const key = `${x},${y},${z}`;
      let id = map.get(key);
      if (id === undefined) {
        id = pos.length / 3;
        map.set(key, id);
        pos.push(x, y, z);
      }
      ids.push(id);
    }
    if (ids[0] !== ids[1] && ids[1] !== ids[2] && ids[0] !== ids[2]) idx.push(...ids);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** STL (이진/ASCII 자동 판별). */
export function parseStl(buf: ArrayBuffer): RawMesh {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      const tri = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12; // 법선 12바이트 건너뜀
        for (let k = 0; k < 9; k++) tri[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return weld(tri);
    }
  }
  const text = new TextDecoder().decode(buf);
  const nums: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) nums.push(+m[1]!, +m[2]!, +m[3]!);
  if (nums.length === 0 || nums.length % 9 !== 0 || nums.some((v) => !Number.isFinite(v))) {
    throw new Error('STL 형식을 해석할 수 없습니다.');
  }
  return weld(new Float32Array(nums));
}

/** OBJ (v, f만 사용). 다각형은 팬 삼각분할, 음수 인덱스 지원. */
export function parseObj(text: string): RawMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') pos.push(+p[1]!, +p[2]!, +p[3]!);
    else if (p[0] === 'f') {
      const nv = pos.length / 3;
      const f = p.slice(1).map((s) => {
        const i = parseInt(s.split('/')[0]!, 10);
        return i < 0 ? nv + i : i - 1;
      });
      for (let k = 1; k + 1 < f.length; k++) idx.push(f[0]!, f[k]!, f[k + 1]!);
    }
  }
  const nv = pos.length / 3;
  if (nv === 0 || idx.length === 0) throw new Error('OBJ에 정점 또는 면이 없습니다.');
  if (idx.some((i) => i < 0 || i >= nv) || pos.some((v) => !Number.isFinite(v))) {
    throw new Error('OBJ 인덱스 또는 좌표가 올바르지 않습니다.');
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** 단위·축 변환을 적용해 MeshSurface로 만든다. 스케일이 이상하면 경고한다. */
export function toMeshSurface(raw: RawMesh, o: ImportOptions): ImportResult {
  const p = convertPositionsToMeters(raw.positions, o.unit);
  if (o.yUp) {
    // Y-up → Z-up: (x, y, z) → (x, -z, y), 우수계 유지
    for (let i = 0; i < p.length; i += 3) {
      const y = p[i + 1]!,
        z = p[i + 2]!;
      p[i + 1] = -z + 0; // +0: -0 방지
      p[i + 2] = y;
    }
  }
  let ext = 0;
  const mn = [Infinity, Infinity, Infinity],
    mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      mn[c] = Math.min(mn[c]!, p[i + c]!);
      mx[c] = Math.max(mx[c]!, p[i + c]!);
    }
  }
  ext = Math.hypot(mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!);
  const warnings: string[] = [];
  if (ext < 0.2)
    warnings.push(`모델 대각선이 ${ext.toFixed(3)} m 입니다. 단위(mm/cm/m)가 맞는지 확인하세요.`);
  if (ext > 1000)
    warnings.push(`모델 대각선이 ${ext.toFixed(0)} m 입니다. 단위(mm/cm/m)가 맞는지 확인하세요.`);
  const id = `mesh-${o.name}`;
  return {
    mesh: { id, name: o.name, positions: p, indices: raw.indices, materialId: o.materialId },
    warnings,
  };
}

/** 파일 이름 확장자로 파싱한다. */
export async function importMeshFile(
  file: File,
  o: Omit<ImportOptions, 'name'>,
): Promise<ImportResult> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '');
  if (ext === 'stl') return toMeshSurface(parseStl(await file.arrayBuffer()), { ...o, name });
  if (ext === 'obj') return toMeshSurface(parseObj(await file.text()), { ...o, name });
  throw new Error('지원 형식은 .stl, .obj 입니다.');
}
