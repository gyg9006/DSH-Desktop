/** 工作文件夹路径的客户端即时校验（6.6：路径非法即时红字；写权限探测仍由主进程在提交时执行）。 */

/** 返回错误文案；空串表示合法。 */
export function validateWorkspacePathInput(value: string): string {
  const v = (value ?? '').trim()
  if (!v) return '路径不能为空'
  if (!/^[A-Za-z]:[\\/]|^\\\\/.test(v)) {
    return '必须是绝对路径（如 D:\\DSH-Workbench）'
  }
  if (/^[A-Za-z]:[\\/]$/.test(v) || /^[A-Za-z]:$/.test(v)) {
    return '不能选择驱动器根目录（如 C:\\）'
  }
  return ''
}
