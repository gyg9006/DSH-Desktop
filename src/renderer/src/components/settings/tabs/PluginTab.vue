<script setup lang="ts">
/**
 * 插件 Tab：功能插件（内置 + 联网搜索）+ 推荐技能（精选 + 联网搜索）+ 已安装（插件 + 技能）。
 * - 功能插件：内置的 dsh 功能插件（离线启用）+ 在线搜索 npmmirror 插件（按名字/功能词）安装。
 * - 推荐技能：50 个精选开源技能 + 联网搜索技能包（按名字/功能词）安装到 workspace/skills。
 * - 已安装：列出通过 npm 安装的插件 与 已安装的技能。
 * 启用/安装写入 $DSH_HOME/cordis.patch.yml 用户层补丁与 profile 的 pnpm dependencies，
 * 技能安装到 workspace/skills/（dsh-skill-filesystem 扫描）。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, RefreshRight, Download, Delete, CircleCheckFilled } from '@element-plus/icons-vue'
import type { InstalledPluginPayload, InstalledSkillInfo, NpmPluginHitPayload, PluginStatePayload, SkillMarketItem } from '@shared/ipc'
import { useServiceStore } from '../../../stores/service'

const service = useServiceStore()

// 功能插件
const curated = ref<PluginStatePayload[]>([])
const installed = ref<InstalledPluginPayload[]>([])
const loaded = ref(false)
const refreshing = ref(false)

// 推荐技能
const skills = ref<SkillMarketItem[]>([])
const skillInstalled = ref<InstalledSkillInfo[]>([])
const skillBusy = ref<string | null>(null)

// 分页（每页 10 个）
const PAGE_SIZE = 10
const pluginPage = ref(1)
const skillPage = ref(1)
const pagedPlugins = computed(() => curated.value.slice((pluginPage.value - 1) * PAGE_SIZE, pluginPage.value * PAGE_SIZE))
const pagedSkills = computed(() => skills.value.slice((skillPage.value - 1) * PAGE_SIZE, skillPage.value * PAGE_SIZE))

// 功能插件：联网搜索（替代原「在线插件市场」）
const query = ref('')
const searching = ref(false)
const searchError = ref('')
const hits = ref<NpmPluginHitPayload[]>([])
const searched = ref(false)

// 推荐技能：联网搜索
const skillQuery = ref('')
const skillSearching = ref(false)
const skillSearchError = ref('')
const skillHits = ref<Array<{ name: string; description: string; keywords: string[] }>>([])
const skillSearched = ref(false)

// 安装/卸载日志
const opLog = ref('')
const installing = ref<string | null>(null)
const uninstalling = ref<string | null>(null)
const restarting = ref(false)

onMounted(async () => {
  await refreshPlugins()
  await refreshSkills()
})

async function refreshPlugins(): Promise<void> {
  const payload = await window.dshw.getPlugins()
  curated.value = payload.curated
  installed.value = payload.installed
  loaded.value = true
}

async function refreshSkills(): Promise<void> {
  const payload = await window.dshw.getSkills()
  skills.value = payload.items
  skillInstalled.value = payload.installed
}

/** 刷新插件/技能列表（重新扫描 bundle 层与已安装状态，实时反映最新推荐）。 */
async function refreshAll(): Promise<void> {
  refreshing.value = true
  try {
    await Promise.all([refreshPlugins(), refreshSkills()])
    ElMessage.success('已刷新')
  } finally {
    refreshing.value = false
  }
}

function onPluginPage(v: number): void {
  pluginPage.value = v
}

function onSkillPage(v: number): void {
  skillPage.value = v
}

async function togglePlugin(p: PluginStatePayload): Promise<void> {
  const target = !p.enabledByUser
  const result = await window.dshw.setPluginEnabled(p.name, target)
  if (result.ok) {
    ElMessage.success(`「${p.title}」已${target ? '启用' : '停用'}（重启 dsh 服务后生效）`)
    await refreshPlugins()
  } else {
    ElMessage.error(result.error ?? '操作失败')
  }
}

/** 功能插件联网搜索（npmmirror，按名字/功能词）。 */
async function doSearch(): Promise<void> {
  if (!query.value.trim()) return
  searching.value = true
  searchError.value = ''
  searched.value = true
  try {
    const result = await window.dshw.searchPlugins(query.value)
    if (result.ok) {
      hits.value = result.hits
      if (result.hits.length === 0) searchError.value = '没有找到匹配的插件，试试「mcp」「skill」「search」等关键词'
    } else {
      searchError.value = result.error ?? '搜索失败'
      hits.value = []
    }
  } finally {
    searching.value = false
  }
}

/** 推荐技能联网搜索（npmmirror 技能包，按名字/功能词）。 */
async function doSkillSearch(): Promise<void> {
  if (!skillQuery.value.trim()) return
  skillSearching.value = true
  skillSearchError.value = ''
  skillSearched.value = true
  try {
    const result = await window.dshw.searchSkills(skillQuery.value)
    if (result.ok) {
      skillHits.value = result.hits
      if (result.hits.length === 0) skillSearchError.value = '没有找到匹配的技能，试试「pdf」「word」「代码审查」等关键词'
    } else {
      skillSearchError.value = result.error ?? '搜索失败'
      skillHits.value = []
    }
  } finally {
    skillSearching.value = false
  }
}

function isInstalled(name: string): boolean {
  return installed.value.some((p) => p.name === name)
}

async function doInstall(pkg: NpmPluginHitPayload): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `从 npm 安装 ${pkg.name}@${pkg.version}？\n该操作会在 dsh 的 web profile 中执行 pnpm add（联网）。`,
      '安装插件',
      { type: 'info', confirmButtonText: '安装', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消，静默返回
  }
  installing.value = pkg.name
  opLog.value = ''
  try {
    const result = await window.dshw.installPlugin(`${pkg.name}@${pkg.version}`)
    if (result.log) opLog.value = result.log
    if (result.ok) {
      ElMessage.success(
        result.bundle
          ? '插件已安装（profile 层，重启服务生效）。注意：这是插件不是技能，如需对话技能请到「推荐技能」页'
          : '安装完成（该包未声明 dsh.bundle，需在 dsh 中确认加载方式）'
      )
      await refreshPlugins()
    } else {
      ElMessage.error(result.error ?? '安装失败')
    }
  } finally {
    installing.value = null
  }
}

/** 安装搜索到的技能包（包内所有含 SKILL.md 的技能都会装进 workspace/skills）。 */
async function doInstallSkillNpm(name: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `从 npm 安装技能包 ${name}？\n包内所有含 SKILL.md 的技能目录都会安装到 workspace/skills（联网）。`,
      '安装技能',
      { type: 'info', confirmButtonText: '安装', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  skillBusy.value = name
  opLog.value = ''
  try {
    const result = await window.dshw.installSkillNpm(name)
    if (result.log) opLog.value = result.log
    if (result.ok) {
      ElMessage.success(`技能已安装：${(result.installed ?? []).join('、') || name}（重启 dsh 服务后生效）`)
      await refreshSkills()
    } else {
      ElMessage.error(result.error ?? '安装失败')
    }
  } finally {
    skillBusy.value = null
  }
}

async function doUninstall(pkg: InstalledPluginPayload): Promise<void> {
  try {
    await ElMessageBox.confirm(`卸载 ${pkg.name}？会从 profile 移除该依赖（重启 dsh 服务后生效）。`, '卸载插件', {
      type: 'warning',
      confirmButtonText: '卸载',
      cancelButtonText: '取消'
    })
  } catch {
    return // 用户取消，静默返回
  }
  uninstalling.value = pkg.name
  opLog.value = ''
  try {
    const result = await window.dshw.uninstallPlugin(pkg.name)
    if (result.log) opLog.value = result.log
    if (result.ok) {
      ElMessage.success('卸载完成（重启 dsh 服务后生效）')
      await refreshPlugins()
    } else {
      ElMessage.error(result.error ?? '卸载失败')
    }
  } finally {
    uninstalling.value = null
  }
}

async function doInstallSkill(s: SkillMarketItem): Promise<void> {
  skillBusy.value = s.id
  opLog.value = ''
  try {
    const result = await window.dshw.installSkill(s.id)
    if (result.log) opLog.value = result.log
    if (result.ok) {
      ElMessage.success(`技能已安装：${(result.installed ?? []).join('、') || s.name}（重启 dsh 服务后生效）`)
      await refreshSkills()
    } else {
      ElMessage.error(result.error ?? '安装失败')
    }
  } finally {
    skillBusy.value = null
  }
}

async function restartService(): Promise<void> {
  restarting.value = true
  try {
    if (service.status !== 'stopped') await service.stop()
    const result = await service.start()
    if (!result.ok) ElMessage.error(result.error ?? '服务重启失败')
    else ElMessage.success('dsh 服务已重启')
  } finally {
    restarting.value = false
  }
}

function fmtDate(d: string): string {
  return d ? d.slice(0, 10) : ''
}
</script>

<template>
  <div>
    <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">插件与技能</h3>
    <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
      <strong class="text-gray-600 dark:text-gray-300">插件</strong>（功能插件）与<strong class="text-gray-600 dark:text-gray-300">技能</strong>（推荐技能）是两类不同的东西：
      插件是扩展 dsh 自身功能的 npm 包（工具、命令等），装进 dsh profile；技能是对话中可直接调用的技能目录（SKILL.md），装进 workspace/skills。
      两个模块都支持<strong class="text-gray-600 dark:text-gray-300">联网搜索</strong>（按名字 / 功能词）并直接安装。
      启用/安装后需<strong class="text-gray-600 dark:text-gray-300">重启 dsh 服务</strong>生效。
    </p>

    <div v-if="service.status === 'running' || service.status === 'starting'" class="mt-3 flex items-center gap-2">
      <span class="status-dot bg-green-500"></span>
      <span class="text-xs text-gray-500 dark:text-gray-400">dsh 服务运行中（端口 {{ service.port }}）</span>
      <el-button size="small" text type="primary" :icon="RefreshRight" :loading="restarting" @click="restartService()">
        重启服务
      </el-button>
    </div>

    <div class="mt-3 flex items-center justify-between">
      <span class="text-xs text-gray-400 dark:text-gray-500">共 {{ curated.length }} 个推荐插件 · {{ skills.length }} 个推荐技能</span>
      <el-button size="small" text :icon="RefreshRight" :loading="refreshing" @click="refreshAll()">刷新</el-button>
    </div>

    <el-tabs v-if="loaded" class="mt-2 plugin-tabs" type="border-card">
      <!-- 功能插件（内置 + 联网搜索） -->
      <el-tab-pane label="功能插件">
        <!-- 联网搜索（替代原在线插件市场） -->
        <div class="mb-3 flex items-center gap-2">
          <el-input
            v-model="query"
            size="small"
            placeholder="联网搜索插件：按名字或功能词（如「搜索」「数据库」「mcp」）"
            clearable
            @keyup.enter="doSearch()"
          />
          <el-button size="small" type="primary" :icon="Search" :loading="searching" @click="doSearch()">搜索</el-button>
        </div>
        <p v-if="searchError" class="mb-2 text-xs text-gray-500 dark:text-gray-400">{{ searchError }}</p>

        <!-- 搜索结果（联网插件） -->
        <div v-if="searched && hits.length > 0" class="mb-3 space-y-2">
          <div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">联网搜索结果（{{ hits.length }}）</div>
          <div
            v-for="hit in hits"
            :key="hit.name"
            class="flex items-start justify-between gap-3 rounded-lg border border-gray-100 p-3 dark:border-[#23262C]"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs font-semibold text-gray-800 dark:text-gray-100">{{ hit.name }}</span>
                <span class="text-[11px] text-gray-400 dark:text-gray-500">v{{ hit.version }}</span>
                <span v-if="hit.name.includes('@deepseek-ai')" class="status-chip source-chip">dsh 官方</span>
                <span v-if="isInstalled(hit.name)" class="status-chip">已安装</span>
              </div>
              <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {{ hit.description || '（无描述）' }}
              </p>
              <p class="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                {{ [hit.author, hit.date ? fmtDate(hit.date) : ''].filter(Boolean).join(' · ') }}
              </p>
            </div>
            <div class="shrink-0">
              <el-button
                v-if="!isInstalled(hit.name)"
                size="small"
                type="primary"
                plain
                :icon="Download"
                :loading="installing === hit.name"
                @click="doInstall(hit)"
              >
                安装
              </el-button>
              <span v-else class="text-[11px] text-gray-400 dark:text-gray-500">已安装</span>
            </div>
          </div>
        </div>

        <!-- 内置推荐插件 -->
        <div class="mb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">内置推荐插件（{{ curated.length }}）</div>
        <div class="space-y-3">
          <div v-for="p in pagedPlugins" :key="p.name" class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded bg-green-500 px-1.5 py-0.5 text-[10px] font-medium text-white">推荐</span>
                  <span class="text-sm font-semibold text-gray-800 dark:text-gray-100">{{ p.title }}</span>
                  <span class="status-chip source-chip" v-if="p.enabledInBundle">已随 dsh 加载</span>
                  <span class="status-chip" v-else-if="p.enabledByUser">桌面端已启用</span>
                  <span class="status-chip !border-gray-200 !bg-gray-50 !text-gray-400 dark:!border-[#2A2E35] dark:!bg-[#1D2026]" v-else>未启用</span>
                </div>
                <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ p.description }}</p>
                <div class="mt-1.5 flex flex-wrap gap-1">
                  <span v-for="t in p.tags" :key="t" class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 dark:bg-[#1E2126] dark:text-gray-500">
                    {{ t }}
                  </span>
                </div>
                <p class="mt-1 font-mono text-[10px] text-gray-400 dark:text-gray-500">{{ p.name }}</p>
              </div>
              <div v-if="!p.enabledInBundle" class="shrink-0">
                <el-switch :model-value="p.enabledByUser" size="small" @change="togglePlugin(p)" />
              </div>
              <span v-else class="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">默认启用</span>
            </div>
          </div>
        </div>
        <div class="mt-3 flex justify-center">
          <el-pagination
            layout="prev, pager, next"
            :total="curated.length"
            :page-size="PAGE_SIZE"
            :current-page="pluginPage"
            small
            @current-change="onPluginPage"
          />
        </div>
      </el-tab-pane>

      <!-- 推荐技能（精选 + 联网搜索） -->
      <el-tab-pane label="推荐技能">
        <!-- 联网搜索 -->
        <div class="mb-3 flex items-center gap-2">
          <el-input
            v-model="skillQuery"
            size="small"
            placeholder="联网搜索技能：按名字或功能词（如「pdf」「word」「代码审查」「文档」）"
            clearable
            @keyup.enter="doSkillSearch()"
          />
          <el-button size="small" type="success" plain :icon="Search" :loading="skillSearching" @click="doSkillSearch()">搜索</el-button>
        </div>
        <p v-if="skillSearchError" class="mb-2 text-xs text-gray-500 dark:text-gray-400">{{ skillSearchError }}</p>

        <!-- 技能搜索结果 -->
        <div v-if="skillSearched && skillHits.length > 0" class="mb-3 space-y-2">
          <div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">联网搜索结果（{{ skillHits.length }}）</div>
          <div
            v-for="hit in skillHits"
            :key="hit.name"
            class="flex items-start justify-between gap-3 rounded-lg border border-gray-100 p-3 dark:border-[#23262C]"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs font-semibold text-gray-800 dark:text-gray-100">{{ hit.name }}</span>
                <span class="status-chip source-chip">npm 技能包</span>
              </div>
              <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {{ hit.description || '（无描述）' }}
              </p>
              <div v-if="hit.keywords.length" class="mt-1 flex flex-wrap gap-1">
                <span v-for="k in hit.keywords.slice(0, 6)" :key="k" class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 dark:bg-[#1E2126] dark:text-gray-500">
                  {{ k }}
                </span>
              </div>
            </div>
            <div class="shrink-0">
              <el-button
                size="small"
                type="success"
                plain
                :icon="Download"
                :loading="skillBusy === hit.name"
                @click="doInstallSkillNpm(hit.name)"
              >
                安装
              </el-button>
            </div>
          </div>
        </div>

        <!-- 精选技能 -->
        <div class="mb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">精选推荐技能（{{ skills.length }}）</div>
        <div class="space-y-2">
          <div
            v-for="s in pagedSkills"
            :key="s.id"
            class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span v-if="s.recommended" class="rounded bg-green-500 px-1.5 py-0.5 text-[10px] font-medium text-white">推荐</span>
                  <span class="text-sm font-semibold text-gray-800 dark:text-gray-100">{{ s.name }}</span>
                  <span v-if="s.source.type === 'npm' || s.source.type === 'npm-skill'" class="status-chip source-chip">npm 直装</span>
                  <span v-else class="status-chip">GitHub</span>
                  <span v-if="s.installed" class="status-chip">已安装</span>
                </div>
                <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ s.description }}</p>
                <div class="mt-1.5 flex flex-wrap gap-1">
                  <span v-for="t in s.tags" :key="t" class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 dark:bg-[#1E2126] dark:text-gray-500">
                    {{ t }}
                  </span>
                </div>
                <p class="mt-1 font-mono text-[10px] text-gray-400 dark:text-gray-500">
                  {{ s.source.type === 'github' ? `${s.source.repo} → ${s.source.path}` : `npm 合集: ${s.source.pkg}${s.source.type === 'npm-skill' ? ' → ' + s.source.skill : ''}` }}
                </p>
              </div>
              <div class="shrink-0">
                <el-button
                  v-if="!s.installed"
                  size="small"
                  type="success"
                  plain
                  :icon="Download"
                  :loading="skillBusy === s.id"
                  @click="doInstallSkill(s)"
                >
                  安装
                </el-button>
                <span v-else class="flex items-center gap-1 text-[11px] text-green-600">
                  <el-icon><CircleCheckFilled /></el-icon>已安装
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="mt-3 flex justify-center">
          <el-pagination
            layout="prev, pager, next"
            :total="skills.length"
            :page-size="PAGE_SIZE"
            :current-page="skillPage"
            small
            @current-change="onSkillPage"
          />
        </div>
        <p class="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
          精选技能来自社区推崇的开源技能库（含 anthropics/skills 与 obra/superpowers 等），经 npmmirror 技能合集直装，无需 GitHub。
          联网搜索可安装任意 npm 技能包（包内含 SKILL.md 目录的技能）。
        </p>
      </el-tab-pane>

      <!-- 已安装（插件 + 技能） -->
      <el-tab-pane label="已安装">
        <div class="mb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">已安装插件（{{ installed.length }}）</div>
        <div v-if="installed.length === 0" class="py-3 text-center text-xs text-gray-400 dark:text-gray-500">
          还没有通过 npm 安装的插件（内置插件见「功能插件」页）
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="p in installed"
            :key="p.name"
            class="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3 dark:border-[#23262C]"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs font-semibold text-gray-800 dark:text-gray-100">{{ p.name }}</span>
                <span class="text-[11px] text-gray-400 dark:text-gray-500">v{{ p.version }}</span>
                <span v-if="p.bundle" class="status-chip source-chip">profile 层</span>
                <span v-if="p.enabled" class="status-chip">桌面端已启用</span>
              </div>
            </div>
            <el-button size="small" text type="danger" :icon="Delete" :loading="uninstalling === p.name" @click="doUninstall(p)">
              卸载
            </el-button>
          </div>
        </div>

        <div class="mb-1 mt-5 text-[11px] font-medium text-gray-400 dark:text-gray-500">已安装技能（{{ skillInstalled.length }}，workspace/skills）</div>
        <div v-if="skillInstalled.length === 0" class="py-3 text-center text-xs text-gray-400 dark:text-gray-500">
          还没有安装技能（见「推荐技能」页）
        </div>
        <div v-else class="space-y-1">
          <div v-for="s in skillInstalled" :key="s.id" class="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 dark:border-[#23262C]">
            <span class="font-mono text-xs text-gray-700 dark:text-gray-200">{{ s.id }}</span>
            <span class="text-[11px] text-gray-400">{{ (s.sizeBytes / 1024).toFixed(1) }} KB</span>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <pre v-if="opLog" class="mt-3 max-h-40 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] leading-relaxed text-green-300">{{ opLog }}</pre>
  </div>
</template>
