// `test` 설정을 쓰기 위해 vitest 가 확장한 defineConfig 를 사용한다.
// vite 의 defineConfig 를 쓰면 test 속성이 타입 오류가 난다.
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],

  // Tauri CLI 의 출력이 지워지지 않도록 한다.
  clearScreen: false,

  server: {
    // ⚠️ Vite 기본 포트 5173 을 쓰지 않는다.
    // 형제 프로젝트 PES(~/apps/pes/web)가 5173 을 쓰기 때문에, 두 프로젝트를 동시에
    // 개발하면 FRAI 창에 PES 사이트가 로드되는 사고가 난다. Tauri 관례 포트인 1420 을 쓴다.
    port: 1420,

    // 포트가 이미 사용 중이면 조용히 다른 포트로 옮겨가지 말고 실패시킨다.
    // 자동 이동은 tauri.conf.json 의 devUrl 과 어긋나 엉뚱한 사이트를 띄운다.
    strictPort: true,

    hmr: { protocol: 'ws', host: 'localhost', port: 1421 },

    // Rust 소스 변경으로 프론트가 재빌드되지 않도록 제외한다.
    watch: { ignored: ['**/src-tauri/**'] },
  },

  // 테스트는 node 환경에서 돈다 — 앱 창을 띄우지 않는다(사람 작업을 방해하지 않기 위함).
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
