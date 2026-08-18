/**
 * 首次启动引导（Onboarding）纯逻辑：环境门槛 / 模型测试入参 / 默认提供方选择。
 * 不依赖 React 与 DOM，可被 vitest（node 环境）直接单测。
 */
import type { EnvItemKey, EnvReport, ModelsTestInput, ModelsViewPayload, ModelProviderPreset } from '@shared/ipc'

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

/** 根据提供方预设构造模型测试入参；预设缺失返回 null。 */
export function buildTestInput(
  providerId: string,
  preset: ModelProviderPreset | undefined,
  model?: string
): ModelsTestInput | null {
  if (!preset) return null
  return {
    providerId,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    model: model ?? preset.defaultModels[0]
  }
}

/**
 * 选择引导 Step 3 默认选中的提供方：
 * 1. 已配置 Key 的预设（keyMasks 非空）优先——可直接「测试现有 Key」；
 * 2. 否则取第一个 keyRequired 的预设；
 * 3. 兜底取列表第一个。
 */
export function pickDefaultProvider(view: ModelsViewPayload | null): string | null {
  if (!view) return null
  const withKey = view.presets.find((p) => (view.keyMasks[p.id] ?? '').length > 0)
  if (withKey) return withKey.id
  const required = view.presets.find((p) => p.keyRequired)
  return required?.id ?? view.presets[0]?.id ?? null
}

/** 提供方名称（无则回退 id）。 */
export function providerName(preset: ModelProviderPreset | undefined, id: string): string {
  return preset?.name ?? id
}
