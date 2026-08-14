/**
 * main 프로세스 번들.
 *
 * ESM 으로 낸다 — `package.json` 의 `"type": "module"` 과 맞추기 위해서다.
 * (Electron 28 이상은 main 프로세스의 ESM 을 지원한다.)
 *
 * `electron` 과 Node 내장 모듈은 번들에 넣지 않는다(런타임이 제공한다).
 */
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist/main',
    emptyOutDir: true,
    // Electron 43 이 쓰는 Node 20+ 문법을 그대로 낸다. 다운레벨 할 이유가 없다.
    target: 'node20',
    minify: false,
    sourcemap: true,
    lib: {
      entry: 'src/main/index.ts',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      external: [
        'electron',
        'electron-updater',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`)
      ]
    }
  }
})
