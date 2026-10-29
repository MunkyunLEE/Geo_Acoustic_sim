import { describe, expect, it } from 'vitest';
import { docsUrl } from '../../src/app/docsUrl';

describe('문서 링크', () => {
  it('하위 경로 base에서 앵커까지 올바른 URL을 만든다', () => {
    expect(docsUrl('physics', '#receiver', '/acoustic-simulator/')).toBe(
      '/acoustic-simulator/docs/physics.html#receiver',
    );
    expect(docsUrl('roadmap', '', '/acoustic-simulator/')).toBe(
      '/acoustic-simulator/docs/roadmap.html',
    );
  });

  it('base 끝 슬래시가 없어도 보정한다', () => {
    expect(docsUrl('physics', '', '/acoustic-simulator')).toBe(
      '/acoustic-simulator/docs/physics.html',
    );
  });

  it('루트 base', () => {
    expect(docsUrl('physics', '#units', '/')).toBe('/docs/physics.html#units');
  });
});
