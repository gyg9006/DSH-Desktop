<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Promotion, VideoPlay, WarningFilled, Operation } from '@element-plus/icons-vue'
import WelcomeView from './welcome/WelcomeView.vue'
import { useServiceStore } from '../stores/service'
import { useUiStore } from '../stores/ui'
import { useAppStore } from '../stores/app'

const service = useServiceStore()
const ui = useUiStore()
const appStore = useAppStore()
const showLogInError = ref(false)
/** dsh 内置侧边栏是否可见（默认隐藏，界面更干净；可在设置 → 通用 中开启） */
const dshSidebarVisible = ref(false)

const sessionTitle = computed(() => '新对话')
const portText = computed(() => (service.port ? String(service.port) : '--'))
const serviceUrl = computed(() => (service.port ? `http://127.0.0.1:${service.port}` : ''))

// ---------- webview ----------
const webviewRef = ref<Electron.WebviewTag | null>(null)
const webviewError = ref(false)
const webviewKey = ref(0)

/** 隐藏 dsh 内置侧边栏的通用 CSS（不依赖动态类名，insertCSS 跨 reload 保留，页面加载早期即生效）。 */
const DSH_RAIL_HIDE_CSS = `[class*="_root"]:has(button[aria-label*="新建会话"]) { display: none !important; }`

/** 注入侧边栏隐藏 CSS（webview insertCSS 持久，reload 后依然生效 → 打开会话刷新时零闪显）。 */
function injectRailHideCss(): void {
  const wv = webviewRef.value
  if (!wv) return
  try {
    wv.insertCSS(DSH_RAIL_HIDE_CSS)
  } catch {
    // 老版本 API 不支持时忽略
  }
}

/** 注入 dsh 侧边栏隐藏（CSS 通用规则为主 + JS 兜底）。
 *  insertCSS 的通用规则不依赖动态类名、跨 reload 保留，reload 后页面加载早期即隐藏 → 零闪显。 */
function injectSidebarHelper(): void {
  const wv = webviewRef.value
  if (!wv) return
  // 1. 注入通用隐藏 CSS（持久生效）
  injectRailHideCss()
  // 2. JS 兜底：立即隐藏 + 观察重建（处理用户开启侧边栏的情况）
  wv.executeJavaScript(`(() => {
    const visible = ${appStore.config?.showDshSidebar === true ? 'true' : 'false'}
    if (window.__dshwSidebarHelper) {
      window.__dshwSidebarHelper.set(${appStore.config?.showDshSidebar === true ? 'true' : 'false'})
      return 'exists'
    }
    const nav = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('新建会话'))
    if (!nav) return 'no-nav-yet'
    let el = nav
    let root = null
    while (el) {
      const cls = typeof el.className === 'string' ? el.className : ''
      if (cls.includes('_root')) { root = el; break }
      el = el.parentElement
    }
    if (!root) return 'no-root'
    const apply = () => {
      // CSS 已隐藏；仅当用户显式开启时强制显示
      root.style.setProperty('display', visible ? '' : 'none', 'important')
    }
    window.__dshwSidebarHelper = { root, visible, railClass: '', set(v) { visible = !!v; apply(); return 'ok' } }
    apply()
    const mo = new MutationObserver(() => {
      if (!document.contains(root)) {
        const nav2 = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('新建会话'))
        if (!nav2) return
        let el2 = nav2
        while (el2) {
          const cls = typeof el2.className === 'string' ? el2.className : ''
          if (cls.includes('_root')) { root = el2; window.__dshwSidebarHelper.root = el2; apply(); break }
          el2 = el2.parentElement
        }
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return 'ready'
  })()`)
    .then((r: unknown) => {
      const status = String(r ?? '')
      dshSidebarVisible.value = appStore.config?.showDshSidebar === true
      if (status === 'no-nav-yet' || status === 'no-root') {
        setTimeout(injectSidebarHelper, 800)
      }
    })
    .catch(() => undefined)
}

/** 切换 dsh 内置侧边栏显示状态（同步配置；CSS 规则在用户开启时移除隐藏）。 */
async function toggleDshSidebar(): Promise<void> {
  const wv = webviewRef.value
  const show = !dshSidebarVisible.value
  dshSidebarVisible.value = show
  if (wv) {
    // 用户开启 → 注入「显示」规则覆盖隐藏；关闭 → 移除覆盖规则恢复隐藏
    try {
      if (show) {
        wv.insertCSS(`[class*="_root"]:has(button[aria-label*="新建会话"]) { display: flex !important; }`)
      } else {
        wv.insertCSS(DSH_RAIL_HIDE_CSS)
      }
    } catch {
      /* 忽略 */
    }
    wv.executeJavaScript(`window.__dshwSidebarHelper ? window.__dshwSidebarHelper.set(${show ? 'true' : 'false'}) : 'n/a'`).catch(() => undefined)
  }
  const result = await window.dshw.updateConfig({ showDshSidebar: show })
  if (result.ok && result.config) appStore.config = result.config
}

function attachWebviewListeners(): void {
  const wv = webviewRef.value
  if (!wv) return
  wv.addEventListener('did-fail-load', () => {
    webviewError.value = true
  })
  // 页面一开始加载只注入 CSS（insertCSS 不依赖 DOM，reload 后持续生效 → 零闪显；
  // 此时 webview 尚未 dom-ready，不能调用 executeJavaScript）
  wv.addEventListener('did-start-loading', () => {
    injectRailHideCss()
  })
  wv.addEventListener('did-finish-load', () => {
    webviewError.value = false
    injectSidebarHelper()
  })
  wv.addEventListener('dom-ready', () => {
    injectSidebarHelper()
  })
}

watch(
  () => service.status,
  (status) => {
    if (status === 'running') {
      webviewError.value = false
      webviewKey.value += 1 // 强制重建 webview（新端口/新会话）
      nextTick(() => attachWebviewListeners())
    }
  },
  { immediate: true }
)

onMounted(() => {
  attachWebviewListeners()
  // 新建对话：回到对话根页
  window.addEventListener('dshw:new-chat', reloadWebview)
  // 工作区操作（Sidebar 触发）：在 webview 内执行 dsh 侧边栏对应功能
  window.addEventListener('dshw:guest-action', handleGuestAction)
})

onBeforeUnmount(() => {
  window.removeEventListener('dshw:new-chat', reloadWebview)
  window.removeEventListener('dshw:guest-action', handleGuestAction)
})

/** 在 dsh web 内执行工作区操作（对应其侧边栏按钮；侧边栏隐藏时按钮仍存在于 DOM，可程序化点击）。 */
function handleGuestAction(event: Event): void {
  const detail = (event as CustomEvent<{ action?: string; payload?: unknown }>).detail
  const action = detail?.action
  const wv = webviewRef.value
  if (!wv) return
  const clickByLabel = (label: string): string => `(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes(${JSON.stringify(label)}))
    if (!btn) return 'NO_BTN'
    btn.click()
    return 'clicked'
  })()`
  if (action === 'new-session') {
    wv.executeJavaScript(clickByLabel('新建会话')).then((r: unknown) => {
      if (String(r) !== 'clicked') wv.reload()
    }).catch(() => wv.reload())
  } else if (action === 'add-workspace') {
    wv.executeJavaScript(clickByLabel('添加工作区')).catch(() => undefined)
  } else if (action === 'search') {
    wv.executeJavaScript(clickByLabel('搜索会话')).catch(() => undefined)
  } else if (action === 'view-mode') {
    // dsh 工作区视图选项：localStorage['dsh.workspace.view.v5'] 的 groupBy / orderBy（dsh-client-ui-workspace 源码核实）
    const patch = (detail?.payload ?? {}) as Record<string, unknown>
    const mode = patch.groupBy === 'flat' || patch.groupBy === 'workspace' ? patch.groupBy : undefined
    const order = patch.orderBy === 'manual' || patch.orderBy === 'updated' ? patch.orderBy : undefined
    wv.executeJavaScript(`(() => {
      try {
        const KEY = 'dsh.workspace.view.v5'
        let v = {}
        try { v = JSON.parse(localStorage.getItem(KEY) || '{}') } catch {}
        ${mode ? `v.groupBy = ${JSON.stringify(mode)}` : ''}
        ${order ? `v.orderBy = ${JSON.stringify(order)}` : ''}
        localStorage.setItem(KEY, JSON.stringify(v))
        return 'ok'
      } catch (e) { return 'ERR:' + e.message }
    })()`)
      .then(() => wv.reload())
      .catch(() => undefined)
  } else if (action === 'open-session') {
    // 打开指定会话：dsh 的当前会话持久化在 localStorage['dsh.sessions.current']。
    // 直接写入并刷新 webview，dsh 启动时会恢复该会话——无需操作 dsh 侧边栏，桌面端侧边栏完全接管。
    const payload = (detail?.payload ?? {}) as { id?: unknown; title?: unknown }
    const sessionId = String(payload.id ?? '')
    if (!sessionId) return
    wv.executeJavaScript(`(() => {
      try {
        localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: ${JSON.stringify(sessionId)} }))
        return 'set'
      } catch (e) { return 'ERR:' + e.message }
    })()`)
      .then((r: unknown) => {
        if (String(r) === 'set') wv.reload()
      })
      .catch(() => undefined)
  }
}

function reloadWebview(): void {
  if (webviewRef.value) {
    webviewRef.value.reload()
  } else {
    webviewError.value = false
    webviewKey.value += 1
  }
}

async function openInBrowser(): Promise<void> {
  if (!service.port) return
  const result = await window.dshw.openExternal(serviceUrl.value)
  if (!result.ok) ElMessage.error(result.error ?? '打开失败')
}

// ---------- 启动日志（骨架屏期可展开） ----------
const logBox = ref<HTMLElement | null>(null)
watch(
  () => service.log.length,
  async () => {
    await nextTick()
    if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
  }
)

async function retryStart(): Promise<void> {
  await service.start()
}
</script>

<template>
  <div class="flex h-full flex-col bg-dsh-60 dark:bg-[#0F1115]">
    <!-- 顶部工具条 -->
    <header
      class="flex h-12 shrink-0 items-center gap-1 border-b border-gray-100 bg-white px-4 dark:border-[#23262C] dark:bg-[#15171B]"
    >
      <div class="min-w-0 flex-1">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ sessionTitle }}</span>
      </div>
      <el-tooltip :content="dshSidebarVisible ? '隐藏 dsh 侧边栏' : '显示 dsh 侧边栏（会话搜索等）'">
        <span>
          <el-button
            text circle
            :disabled="service.status !== 'running'"
            :class="{ 'text-brand': dshSidebarVisible }"
            aria-label="显示或隐藏 dsh 侧边栏"
            @click="toggleDshSidebar()"
          >
            <el-icon><Operation /></el-icon>
          </el-button>
        </span>
      </el-tooltip>
      <el-tooltip content="刷新">
        <span>
          <el-button text circle :disabled="service.status !== 'running'" @click="reloadWebview()">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </span>
      </el-tooltip>
      <el-tooltip content="在系统浏览器打开">
        <span>
          <el-button text circle :disabled="service.status !== 'running'" @click="openInBrowser()">
            <el-icon><Promotion /></el-icon>
          </el-button>
        </span>
      </el-tooltip>
      <el-tag size="small" type="info" effect="plain">端口：{{ portText }}</el-tag>
    </header>

    <!-- 内容区：按服务状态切换（规格 5.3） -->
    <div class="min-h-0 flex-1 overflow-hidden">
      <!-- 服务未启动：欢迎页 -->
      <div v-if="service.status === 'stopped'" class="h-full overflow-y-auto">
        <WelcomeView />
      </div>

      <!-- 服务启动中：骨架屏 + 启动日志（可展开） -->
      <div v-else-if="service.status === 'starting'" class="flex h-full flex-col items-center justify-center px-8">
        <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <el-icon class="animate-spin text-brand"><VideoPlay /></el-icon>
          <span>正在启动 dsh 服务（端口 {{ portText }}）…</span>
        </div>
        <el-skeleton :rows="6" animated class="mt-8 w-full max-w-xl" />
        <div class="mt-6 w-full max-w-xl rounded-lg border border-gray-100 bg-white p-3 dark:border-[#23262C] dark:bg-[#15171B]">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs font-medium text-gray-500 dark:text-gray-400">启动日志</span>
          </div>
          <pre
            ref="logBox"
            class="max-h-44 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-gray-600 dark:text-gray-300"
          >{{ service.log.join('\n') || '（等待输出…）' }}</pre>
        </div>
      </div>

      <!-- 服务运行中：webview 内嵌对话 -->
      <div v-else-if="service.status === 'running'" class="h-full w-full">
        <webview
          v-if="serviceUrl"
          :key="webviewKey"
          ref="webviewRef"
          :src="serviceUrl"
          class="h-full w-full"
          partition="persist:dsh-web"
        />
      </div>

      <!-- 加载失败/异常：错误页 -->
      <div v-else class="flex h-full flex-col items-center justify-center px-8">
        <el-icon :size="44" class="text-red-400"><WarningFilled /></el-icon>
        <h3 class="mt-4 text-base font-semibold text-gray-700 dark:text-gray-200">服务异常</h3>
        <p class="mt-2 max-w-md text-center text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {{ webviewError ? '对话窗口加载失败' : 'dsh 服务未能正常工作' }}，可重试或查看启动日志。
        </p>
        <div class="mt-6 flex items-center gap-3">
          <el-button type="primary" :loading="service.starting" @click="retryStart()">重试</el-button>
          <el-button @click="showLogInError = !showLogInError">查看日志</el-button>
        </div>
        <div v-if="showLogInError" class="mt-4 w-full max-w-xl rounded-lg border border-gray-100 bg-white p-3 dark:border-[#23262C] dark:bg-[#15171B]">
          <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">{{ service.log.join('\n') || '（无日志）' }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
