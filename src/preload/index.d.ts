import type { DshwApi } from './index'

declare global {
  interface Window {
    /** preload 暴露的安全白名单 API。 */
    dshw: DshwApi
  }
}

export {}
