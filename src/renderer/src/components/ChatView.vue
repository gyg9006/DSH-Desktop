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

/** 注入 dsh 侧边栏切换助手（结构性定位：含「新建会话」导航按钮的窄栏根容器）。
 *  同时：① 用 insertCSS 注入「隐藏」样式，在重渲染/刷新时提前生效（消除闪显）；
 *  ② MutationObserver 兜底：即使 dsh 重建侧边栏根节点，隐藏状态也会被重新应用。 */
function injectSidebarHelper(): void {
  const wv = webviewRef.value
  if (!wv) return
  wv.executeJavaScript(`(() => {
    if (window.__dshwSidebarHelper && window.__dshwSidebarHelper.root) return 'exists'
    const nav = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('新建会话'))
    if (!nav) return 'no-nav-yet'
    let el = nav
    let root = null
    while (el) {
      const cls = typeof el.className === 'string' ? el.className : ''
      if (cls.includes('_root') && el.getBoundingClientRect().width < 150) { root = el; break }
      el = el.parentElement
    }
    if (!root) return 'no-root'
    const railClass = (root.className || '').toString().split(' ')[0] || ''
    let visible = false
    if (window.__dshwSidebarHelper) visible = window.__dshwSidebarHelper.visible
    const apply = () => { root.style.display = visible ? '' : 'none'; document.body.toggleAttribute('data-dshw-rail', !visible) }
    window.__dshwSidebarHelper = {
      root,
      visible,
      railClass,
      set(v) { visible = !!v; apply(); return 'ok' }
    }
    apply()
    // 前端重渲染重建根节点时保持隐藏
    const mo = new MutationObserver(() => {
      if (!document.contains(root)) {
        const nav2 = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('新建会话'))
        if (!nav2) return
        let el2 = nav2
        while (el2) {
          const cls = typeof el2.className === 'string' ? el2.className : ''
          if (cls.includes('_root') && el2.getBoundingClientRect().width < 150) { root = el2; break }
          el2 = el2.parentElement
        }
        if (root) { window.__dshwSidebarHelper.root = root; apply() }
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return 'ready'
  })()`)
    .then((r: unknown) => {
      const status = String(r ?? '')
      if (status === 'ready' || status === 'exists') {
        const show = appStore.config?.showDshSidebar === true
        dshSidebarVisible.value = show
        // insertCSS：隐藏样式提前生效（body 属性开关，刷新/切视图时不再闪显 dsh 侧边栏）
        wv.executeJavaScript(`(() => {
          const cls = window.__dshwSidebarHelper ? window.__dshwSidebarHelper.railClass : ''
          window.__dshwSidebarHelper ? window.__dshwSidebarHelper.set(${show ? 'true' : 'false'}) : null
          return cls
        })()`)
          .then((cls: unknown) => {
            const c = String(cls ?? '')
            if (!c) return
            try {
              wv.insertCSS(`body[data-dshw-rail] .${c} { display: none !important; }`)
            } catch {
              // 老版本 API 不支持时忽略
            }
          })
          .catch(() => undefined)
      } else if (status === 'no-nav-yet' || status === 'no-root') {
        setTimeout(injectSidebarHelper, 800)
      }
    })
    .catch(() => undefined)
}

/** 切换 dsh 内置侧边栏显示状态（同步配置，重启会话后保持）。 */
async function toggleDshSidebar(): Promise<void> {
  const wv = webviewRef.value
  const show = !dshSidebarVisible.value
  dshSidebarVisible.value = show
  if (wv) {
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
    // 打开指定会话：在 dsh 工作区会话列表中按标题定位并点击
    const title = String(detail?.payload ?? '')
    if (!title) return
    wv.executeJavaScript(`(() => {
      const items = [...document.querySelectorAll('button, [role=button], li, a, [class*=row], [class*=item], [class*=session]')]
      const target = items
        .filter(el => (el.innerText || '').trim() === ${JSON.stringify(title)})
        .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0]
      if (target) { target.click(); return 'clicked' }
      // 兜底：包含标题的最近元素
      const loose = items.find(el => {
        const t = (el.innerText || '').trim()
        return t.includes(${JSON.stringify(title)}) && t.length < 160
      })
      if (loose) { loose.click(); return 'clicked-loose' }
      return 'no-hit'
    })()`).catch(() => undefined)
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
