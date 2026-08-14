/**
 * preload 번들.
 *
 * ⚠️ CommonJS(`.cjs`)로 낸다. Electron 의 preload 는 ESM 을 쓰려면 파일이 `.mjs` 여야
 * 하고 제약이 더 붙는다. preload 는 수십 줄짜리 화이트리스트라 모듈 형식의 이점이
 * 없으므로, 가장 확실하게 동작하는 CJS 를 택한다.
 * (`package.json` 이 `"type": "module"` 이라 `.js` 로 내면 ESM 으로 해석되어 깨진다.)
 */
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist/preload',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: true,
    lib: {
      entry: 'src/preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.cjs'
    },
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)]
    }
  }
})
