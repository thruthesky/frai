/**
 * 테스트 전용 설정.
 *
 * renderer 빌드 설정(`vite.renderer.config.ts`)은 `root` 가 `src/renderer` 라서
 * 그 파일에 테스트를 얹으면 main·shared 가 범위 밖으로 밀리고, Svelte 플러그인이
 * `.svelte.ts`(runes) 를 변환하지 못해 `$state is not defined` 가 난다.
 * 그래서 테스트는 프로젝트 루트를 기준으로 별도 설정에서 돌린다.
 *
 * ⚠️ node 환경에서 돌며 앱 창을 띄우지 않는다. main 로직이 `electron` 을 import
 *    하지 않는 덕분에 어댑터를 실제로 끝까지 돌리면서도 창이 필요 없다.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
