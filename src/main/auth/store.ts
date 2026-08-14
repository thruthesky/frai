/**
 * 세션 토큰 저장소 — OS 가 보호하는 저장소에 둔다.
 *
 * ⚠️ 이 파일은 `electron` 을 import 하는 **유일한 auth 파일**이다. 그래서 로직을
 * 두지 않고 얇게 유지한다(암·복호화와 파일 입출력뿐). 로그인 흐름 자체는
 * `auth/index.ts` 에 있고 이 인터페이스를 주입받으므로 창 없이 테스트된다.
 *
 * macOS 는 키체인, Windows 는 DPAPI 가 뒤를 받친다(`safeStorage`).
 * 암호화를 쓸 수 없는 환경이면 저장하지 않는다 — 토큰을 평문으로 남기느니
 * 매번 다시 로그인하게 하는 편이 낫다.
 */

import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { SessionStore, StoredSession } from './index.js'

export function createSessionStore(filePath: string): SessionStore {
  return {
    load(): StoredSession | null {
      try {
        const enc = readFileSync(filePath)
        if (!safeStorage.isEncryptionAvailable()) return null
        return JSON.parse(safeStorage.decryptString(enc)) as StoredSession
      } catch {
        return null
      }
    },

    save(s: StoredSession): void {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('이 환경에서는 암호화 저장을 쓸 수 없어 세션을 보관하지 않는다.')
        return
      }
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, safeStorage.encryptString(JSON.stringify(s)))
    },

    clear(): void {
      try {
        rmSync(filePath, { force: true })
      } catch (e) {
        console.warn(`세션 삭제 실패: ${String(e)}`)
      }
    }
  }
}
