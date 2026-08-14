// 테스트 설정은 vitest.config.ts 에 따로 있다(root 가 달라야 하기 때문).
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  // root 가 src/renderer 라 루트의 svelte.config.js 를 자동으로 찾지 못한다.
  plugins: [svelte({ configFile: '../../svelte.config.js' })],

  // renderer 만 담당한다. main·preload 는 각자 vite.*.config.ts 로 빌드한다.
  root: 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },

  // Electron 프로세스의 출력이 지워지지 않도록 한다.
  clearScreen: false,

  server: {
    // ⚠️ Vite 기본 포트 5173 을 쓰지 않는다.
    // 형제 프로젝트 PES(~/apps/pes/web)가 5173 을 쓰기 때문에, 두 프로젝트를 동시에
    // 개발하면 FRAI 창에 PES 사이트가 로드되는 사고가 난다. Tauri 관례 포트인 1420 을 쓴다.
    port: 1420,

    // 포트가 이미 사용 중이면 조용히 다른 포트로 옮겨가지 말고 실패시킨다.
    // 자동 이동은 main 이 여는 URL 과 어긋나 엉뚱한 사이트를 띄운다.
    strictPort: true,

    hmr: { protocol: 'ws', host: 'localhost', port: 1421 },

    // main·preload·Rust 잔재 변경으로 프론트가 재빌드되지 않도록 제외한다.
    watch: { ignored: ['**/src-tauri/**', '**/src/main/**', '**/src/preload/**'] },
  },

})
