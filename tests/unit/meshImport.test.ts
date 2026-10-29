import { describe, expect, it } from 'vitest';
import { parseObj, parseStl, toMeshSurface } from '../../src/io/meshImport';

const asciiStl = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1000 0 0
vertex 0 1000 0
endloop
endfacet
facet normal 0 0 1
outer loop
vertex 1000 0 0
vertex 1000 1000 0
vertex 0 1000 0
endloop
endfacet
endsolid`;

describe('meshImport', () => {
  it('ASCII STL: 삼각형 2개, 정점 용접 4개', () => {
    const m = parseStl(new TextEncoder().encode(asciiStl).buffer as ArrayBuffer);
    expect(m.indices.length).toBe(6);
    expect(m.positions.length / 3).toBe(4);
  });
  it('이진 STL', () => {
    const b = new ArrayBuffer(84 + 50);
    const dv = new DataView(b);
    dv.setUint32(80, 1, true);
    [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, k) => dv.setFloat32(84 + 12 + k * 4, v, true));
    const m = parseStl(b);
    expect(m.indices.length).toBe(3);
  });
  it('OBJ: 사각형 팬 분할 + 음수 인덱스', () => {
    const m = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\nf -4 -3 -2');
    expect(m.indices.length).toBe(9);
  });
  it('단위 mm→m 변환과 크기 경고', () => {
    const raw = parseStl(new TextEncoder().encode(asciiStl).buffer as ArrayBuffer);
    const ok = toMeshSurface(raw, { unit: 'mm', yUp: false, materialId: 'x', name: 'a' });
    expect(Math.max(...ok.mesh.positions)).toBeCloseTo(1, 6);
    expect(ok.warnings.length).toBe(0);
    const bad = toMeshSurface(raw, { unit: 'm', yUp: false, materialId: 'x', name: 'a' });
    expect(bad.warnings.length).toBe(1);
  });
  it('Y-up → Z-up: (0,1,0) → (0,0,1)', () => {
    const raw = parseObj('v 0 1 0\nv 1 0 0\nv 0 0 1\nf 1 2 3');
    const r = toMeshSurface(raw, { unit: 'm', yUp: true, materialId: 'x', name: 'a' });
    expect(Array.from(r.mesh.positions.slice(0, 3))).toEqual([0, 0, 1]);
  });
  it('잘못된 입력은 예외', () => {
    expect(() => parseObj('hello')).toThrow();
    expect(() => parseStl(new ArrayBuffer(10))).toThrow();
  });
});
