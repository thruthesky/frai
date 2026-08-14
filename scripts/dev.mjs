#!/usr/bin/env node
/**
 * 개발 실행 — Vite dev 서버(renderer)를 띄우고 Electron 을 붙인다.
 *
 * 별도 패키지(concurrently 등)를 쓰지 않는다(의존성 최소 원칙). 서버가 실제로
 * 준비된 것을 확인한 뒤 Electron 을 띄우므로, 흰 화면이나 연결 실패로 시작하지 않는다.
 *
 * ⚠️ 사람이 직접 볼 때만 실행한다. 인공지능은 검증 목적으로 앱 창을 띄우지 않는다
 *    (사람의 작업 화면을 빼앗지 않기 위함 — TEST 원칙).
 */

import { spawn } from 'node:child_process'
import { createServer } from 'vite'

const PORT = 1420

const server = await createServer({ configFile: 'vite.renderer.config.ts' })
await server.listen()

const url = `http://localhost:${PORT}`
console.log(`\n▶ renderer  ${url}`)

// electron 실행 파일 경로는 패키지가 알려준다.
const electronPath = (await import('electron')).default

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, FRAI_DEV_URL: url, NODE_ENV: 'development' }
})

const shutdown = async () => {
  await server.close()
  process.exit(0)
}

child.on('close', shutdown)
process.on('SIGINT', () => {
  child.kill()
  void shutdown()
})
