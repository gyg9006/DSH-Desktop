import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // 串行执行测试文件：避免真实 tar 打包 / 端口探测等测试在并行下的资源竞争（偶发失败）
    fileParallelism: false,
    // 真实 tar/网络类测试偶发系统级失败（如 tar.exe 短暂占用），失败自动重试一次
    retry: 1
  },
  resolve: {
    alias: {
      '@shared': resolve(process.cwd(), 'src/shared')
    }
  }
})
