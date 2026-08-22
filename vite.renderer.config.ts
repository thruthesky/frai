// 테스트 설정은 vitest.config.ts 에 따로 있다(root 가 달라야 하기 때문).
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { cspFor } from './src/shared/csp.js'

/**
 * 배포 빌드의 `index.html` 에 CSP `<meta>` 를 넣는다.
 *
 * ⚠️ 이것이 없으면 **배포본에는 CSP 가 전혀 없다.** main 은 `onHeadersReceived` 로
 * CSP 를 주입하는데, 배포본은 `loadFile()`(`file://`)이라 그 훅이 걸리지 않기 때문이다.
 * 개발 서버(http)는 헤더가 정상 동작하므로 meta 를 넣지 않는다 — HMR 연결까지
 * 정적 문자열에 박아 두면 포트를 바꿀 때마다 깨진다.
 */
function cspMetaPlugin(): Plugin {
  return {
    name: 'frai-csp-meta',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (ctx.server) return html // 개발 서버는 헤더가 담당한다
        const meta = `<meta http-equiv="Content-Security-Policy" content="${cspFor({ dev: false, forMeta: true })}" />`
        return html.replace('<head>', `<head>\n    ${meta}`)
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  // root 가 src/renderer 라 루트의 svelte.config.js 를 자동으로 찾지 못한다.
  plugins: [svelte({ configFile: '../../svelte.config.js' }), cspMetaPlugin()],

  // 🛑 `base: './'` 를 빼지 말 것.
  //
  // 기본값(`/`)이면 빌드 산출물이 `/assets/index-xxx.js` 라는 **루트 절대 경로**를 낸다.
  // 배포본은 `loadFile()` 로 여는 `file://` 이므로 그 경로는 **디스크 루트**를 가리키고,
  // 스크립트·CSS 가 통째로 404 가 되어 **흰 화면**이 뜬다. 개발 모드(http)에서는 멀쩡히
  // 동작하므로 눈치채기 어렵다 — 2026-08-22 캡처 검증에서 처음 발견했다.
  base: './',

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
