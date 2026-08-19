/**
 * 首次启动引导（Onboarding）纯逻辑：环境门槛 / 模型测试入参 / 默认提供方选择。
 * 不依赖 React 与 DOM，可被 vitest（node 环境）直接单测。
 */
import type { EnvItemKey, EnvReport } from '@shared/ipc'

/** 全部环境项均为 ok（引导 Step 2 的「下一步」门槛）。 */
export function allEnvOk(report: EnvReport | null): boolean {
  if (!report) return false
  return report.items.length > 0 && report.items.every((item) => item.state === 'ok')
}

/** 需要安装（missing）或更新（incompatible）的组件键列表。 */
export function envItemsNeedingAction(report: EnvReport | null): EnvItemKey[] {
  if (!report) return []
  return report.items
    .filter((item) => item.state === 'missing' || item.state === 'incompatible')
    .map((item) => item.key)
}

