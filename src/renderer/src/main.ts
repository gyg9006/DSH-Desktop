import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './assets/main.css'
import App from './App.vue'
import type { LogLevel } from '../../shared/ipc'

const app = createApp(App)

app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })

app.mount('#app')

// 渲染进程全局错误边界：上报主进程日志，避免白屏
function reportRendererError(level: LogLevel, message: string): void {
  try {
    window.dshw.reportLog(level, message)
  } catch {
    // preload 不可用时静默
  }
}

window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? event.error.stack ?? event.error.message : `${event.message} @ ${event.filename}:${event.lineno}`
  reportRendererError('error', `页面脚本错误：${message}`)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason)
  reportRendererError('error', `未处理的 Promise 拒绝：${reason}`)
})
