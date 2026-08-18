/**
 * 共享 YAML 读写（对 dsh 托管文件：settings.yaml / .credentials.yaml / cordis.patch.yml）。
 *
 * 关键点：js-yaml 默认 schema 会把 `2024-01-01` 解析成 Date、`0x10`/`1e3` 规范化为
 * 十进制、并丢掉注释——对 dsh 托管的配置文件做 load→dump 全文往返会静默改写数据。
 * 这里统一使用 JSON_SCHEMA（纯 JSON 类型，无时间戳/进制转换），保证往返安全。
 */
import yaml from 'js-yaml'

/** 读取 YAML 文本为对象；空文本 / 解析失败返回 null。 */
export function loadYamlObject(text: string | undefined | null): Record<string, unknown> | null {
  const loaded = loadYamlAny(text)
  return loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? (loaded as Record<string, unknown>) : null
}

/** 读取 YAML 文本为任意值（对象/数组均可）；空文本 / 解析失败返回 null。 */
export function loadYamlAny(text: string | undefined | null): unknown {
  if (!text || !text.trim()) return null
  try {
    return yaml.load(text, { schema: yaml.JSON_SCHEMA })
  } catch {
    return null
  }
}

/** 对象序列化为 YAML（与 dsh 风格一致的宽行输出，不做排序/引用折叠）。 */
export function dumpYaml(value: Record<string, unknown> | unknown[]): string {
  return yaml.dump(value, { lineWidth: -1, noRefs: true, noCompatMode: true, sortKeys: false, schema: yaml.JSON_SCHEMA })
}
