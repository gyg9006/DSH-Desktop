import { describe, expect, it } from 'vitest'
import { validateWorkspacePathInput } from '../workspaceValidation'

describe('validateWorkspacePathInput（工作文件夹路径客户端即时校验，规格 6.6）', () => {
  it('空路径报错', () => {
    expect(validateWorkspacePathInput('')).toContain('不能为空')
    expect(validateWorkspacePathInput('   ')).toContain('不能为空')
  })

  it('相对路径报错', () => {
    expect(validateWorkspacePathInput('relative/path')).toContain('必须是绝对路径')
    expect(validateWorkspacePathInput('.\\ws')).toContain('必须是绝对路径')
  })

  it('驱动器根目录报错', () => {
    expect(validateWorkspacePathInput('C:\\')).toContain('驱动器根目录')
    expect(validateWorkspacePathInput('D:/')).toContain('驱动器根目录')
  })

  it('合法绝对路径通过', () => {
    expect(validateWorkspacePathInput('D:\\DSH-Workbench')).toBe('')
    expect(validateWorkspacePathInput('C:/Users/me/workspace')).toBe('')
  })

  it('UNC 路径通过', () => {
    expect(validateWorkspacePathInput('\\\\server\\share\\ws')).toBe('')
  })
})
