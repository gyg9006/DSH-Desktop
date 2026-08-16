/** 展示用格式化工具。 */

/** 路径中段截断，如 "F:\\...\\DSH-Workbench\\workspace" 。 */
export function truncateMiddle(input: string, max = 24): string {
  if (!input) return ''
  if (input.length <= max) return input
  const half = Math.floor((max - 3) / 2)
  return `${input.slice(0, half)}...${input.slice(-half)}`
}

/** 环境状态到中文文案。 */
export function envStateText(state: 'ok' | 'missing' | 'incompatible' | 'error'): string {
  switch (state) {
    case 'ok':
      return '正常'
    case 'missing':
      return '未安装'
    case 'incompatible':
      return '版本不兼容'
    case 'error':
      return '检测异常'
  }
}
