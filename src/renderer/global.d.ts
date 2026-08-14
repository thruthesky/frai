import type { FraiApi } from '../shared/types'

declare global {
  interface Window {
    /**
     * preload 가 `contextBridge` 로 심어 주는 유일한 통로.
     * 여기 없는 기능은 renderer 가 할 수 없다 — 그것이 이 앱의 신뢰 경계다.
     */
    readonly frai: FraiApi
  }
}

export {}
