import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages 프로젝트 사이트 경로. 저장소 이름이 다르면 VITE_BASE로 덮어쓴다.
// 예) VITE_BASE=/my-repo/ npm run build
const base = process.env.VITE_BASE ?? './';

export default defineConfig({
  base, // 모든 자산·문서·워커 URL의 기준 경로 (끝에 슬래시 필수)
  plugins: [react()],
  build: {
    outDir: 'docs', // GitHub Pages "Deploy from a branch"(main /docs)용 빌드 산출물 위치
    target: 'es2022', // 최신 데스크톱 브라우저 기준 (Chrome/Edge 우선)
    chunkSizeWarningLimit: 900, // three.js 번들 크기 경고 완화 (kB)
  },
  test: {
    environment: 'node', // 솔버 코어는 DOM 비의존이므로 node 환경
    include: ['tests/**/*.test.ts'],
  },
});
