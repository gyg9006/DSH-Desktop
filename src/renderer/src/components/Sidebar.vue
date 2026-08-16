<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, ElSelect, ElOption } from 'element-plus'
import type { ElMessageBoxOptions } from 'element-plus'
import {
  Plus,
  Setting,
  Fold,
  Expand,
  Sunny,
  Moon,
  Monitor,
  FolderOpened,
  ChatDotRound,
  Upload,
  Connection,
  Key,
  DataAnalysis,
  Document,
  RefreshLeft,
  VideoPlay,
  Grid,
  ArrowDown,
  Search,
  FolderAdd,
  Back,
  ArrowRight,
  ArrowDown as ArrowDownIcon,
  MoreFilled,
  EditPen,
  Delete,
  Star,
  StarFilled,
  CollectionTag,
  Folder,
  Aim,
  CopyDocument,
  List,
  Download,
  CircleCheckFilled
} from '@element-plus/icons-vue'
import AppLogo from './AppLogo.vue'
import { useAppStore } from '../stores/app'
import { useUiStore } from '../stores/ui'
import { useServiceStore } from '../stores/service'
import { truncateMiddle } from '../utils/format'
import type { ArchivedSessionEntry, SessionGroupInfo, SidebarDataPayload, WorkspaceEntryPayload, WorkspaceSessionEntry } from '../../../shared/ipc'

const appStore = useAppStore()
const ui = useUiStore()
const service = useServiceStore()

const collapsed = computed(() => ui.sidebarCollapsed)
const shortWorkspace = computed(() => truncateMiddle(appStore.workspacePath, 30))
const importing = ref(false)

/** 导入模式选择对话框 */
const importDialog = ref(false)
const importMode = ref<'folder' | 'file'>('folder')
const importTargetWs = ref<WorkspaceEntryPayload | null>(null)

/** 会话视图子导航：日常工作 / 归档 */
const chatSubView = ref<'daily' | 'archive'>('daily')

/** 桌面侧边栏视图选项（对当前视图实际生效，同时同步 dsh） */
const viewMode = ref<{ groupBy: 'workspace' | 'flat'; orderBy: 'manual' | 'updated' }>({ groupBy: 'workspace', orderBy: 'updated' })

// ---------- 侧边栏会话数据 ----------
const data = ref<SidebarDataPayload>({ workspaces: [], groups: [], archived: [], favorites: [], groupMap: {} })
const wsLoaded = ref(false)
const expandedWs = ref<Set<string>>(new Set())
const expandedGroups = ref<Set<string>>(new Set())
const actionBusy = ref<string | null>(null)
const exportingSession = ref(false)
const searchOpen = ref(false)
const searchText = ref('')
/** 归档搜索：关键词 + 时间 */
const archiveKeyword = ref('')
const archiveTime = ref('')
const archiveExpanded = ref(true)

const favorites = computed(() => new Set(data.value.favorites))

// ---------- 多选与批量删除 ----------
/** 多选模式：none=关闭；daily=日常工作；archive=归档 */
const selectMode = ref<'none' | 'daily' | 'archive'>('none')
/** 选中的会话 id（daily 或 archive 通用） */
const selectedIds = ref<Set<string>>(new Set())
/** 选中的分组 id（仅 daily 分组行） */
const selectedGroupIds = ref<Set<string>>(new Set())

function enterSelect(mode: 'daily' | 'archive'): void {
  selectMode.value = mode
  selectedIds.value = new Set()
  selectedGroupIds.value = new Set()
}

function exitSelect(): void {
  selectMode.value = 'none'
  selectedIds.value = new Set()
  selectedGroupIds.value = new Set()
}

function toggleSelect(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleGroupSelect(id: string): void {
  const next = new Set(selectedGroupIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedGroupIds.value = next
}

/** checkbox change 回调：选中/取消。 */
function markSelect(id: string, on: boolean): void {
  const next = new Set(selectedIds.value)
  if (on) next.add(id)
  else next.delete(id)
  selectedIds.value = next
}

function markGroupSelect(id: string, on: boolean): void {
  const next = new Set(selectedGroupIds.value)
  if (on) next.add(id)
  else next.delete(id)
  selectedGroupIds.value = next
}

/** 全选当前可见会话（日常视图：flat 列表或工作区树内全部；归档：过滤后全部）。 */
function selectAllVisible(): void {
  if (selectMode.value === 'archive') {
    selectedIds.value = new Set(filteredArchived.value.map((a) => a.sessionId))
    return
  }
  const ids = new Set<string>()
  if (viewMode.value.groupBy === 'flat') {
    for (const s of filterSessions(flatSessions.value)) ids.add(s.id)
  } else {
    for (const ws of data.value.workspaces) {
      for (const s of filterSessions(sortSessions(ws.sessions))) ids.add(s.id)
    }
  }
  selectedIds.value = ids
}

/** 删除选中会话（日常）或选中归档会话。 */
async function deleteSelected(): Promise<void> {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const label = selectMode.value === 'archive' ? '归档会话' : '会话'
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 个${label}？相关文件将被永久删除。`, `删除${label}`, {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
  } catch {
    return
  }
  const result =
    selectMode.value === 'archive'
      ? await window.dshw.deleteArchivedSessions(ids)
      : await window.dshw.deleteSessions(ids)
  if (result.ok) {
    ElMessage.success(`已删除 ${result.count ?? ids.length} 个${label}`)
    exitSelect()
    await refreshData()
  } else {
    ElMessage.error(result.error ?? '删除失败')
  }
}

/** 批量删除选中分组（每组删除前按 includeContents 确认）。 */
async function deleteSelectedGroups(): Promise<void> {
  const ids = [...selectedGroupIds.value]
  if (ids.length === 0) return
  let includeContents = false
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 个分组？`, '删除分组', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      checkboxMessage: '同时删除分组内全部会话（不勾选则会话移回工作文件夹）',
      checkboxChecked: false,
      beforeClose: (action, instance, done) => {
        if (action === 'confirm') {
          includeContents = (instance as unknown as { checkboxChecked?: boolean }).checkboxChecked === true
          done()
        } else {
          done()
        }
      }
    } as ElMessageBoxOptions)
  } catch {
    return
  }
  let okCount = 0
  for (const gid of ids) {
    const r = await window.dshw.deleteSessionGroup(gid, includeContents)
    if (r.ok) okCount++
  }
  ElMessage.success(okCount > 0 ? `已删除 ${okCount} 个分组` : '没有可删除的分组')
  exitSelect()
  await refreshData()
}

async function refreshData(): Promise<void> {
  data.value = await window.dshw.getSidebarData()
  wsLoaded.value = true
  if (expandedWs.value.size === 0) {
    const current = data.value.workspaces.find((w) => w.path.replace(/\\/g, '/').replace(/\/+$/, '') === (appStore.workspacePath ?? '').replace(/\\/g, '/').replace(/\/+$/, ''))
    if (current) expandedWs.value.add(current.id)
  }
}

/** 视图选项：对桌面侧边栏实际生效（分组方式/排序方式），并同步 dsh。 */
function applyViewOption(group: string, value: string): void {
  const key = group === '排序方式' ? 'orderBy' : 'groupBy'
  const next = { ...viewMode.value }
  if (key === 'orderBy') next.orderBy = value === 'manual' ? 'manual' : 'updated'
  else next.groupBy = value === 'flat' ? 'flat' : 'workspace'
  viewMode.value = next
  void window.dshw.updateConfig({ sidebarView: next }).then((r) => {
    if (r.ok && r.config) appStore.config = r.config
  })
  // 同步 dsh 网页端视图选项
  window.dispatchEvent(new CustomEvent('dshw:guest-action', { detail: { action: 'view-mode', payload: { [key]: next[key] } } }))
}

/** 会话列表排序（手动=注册表顺序；最近更新=时间倒序）。 */
function sortSessions<T extends { time: number }>(list: T[]): T[] {
  if (viewMode.value.orderBy === 'updated') {
    return [...list].sort((a, b) => b.time - a.time)
  }
  return list
}

/** 单列表模式：所有工作区的会话平铺。 */
const flatSessions = computed(() => {
  const all: Array<WorkspaceSessionEntry & { wsTitle: string }> = []
  for (const ws of data.value.workspaces) {
    for (const s of ws.sessions) all.push({ ...s, wsTitle: ws.title })
  }
  return sortSessions(all)
})

function toggleSet(set: Set<string>, key: string): void {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return void (set === expandedWs.value ? (expandedWs.value = next) : (expandedGroups.value = next))
}

const isWsExpanded = (id: string): boolean => expandedWs.value.has(id)
const isGroupExpanded = (id: string): boolean => expandedGroups.value.has(id)

function groupsOf(ws: WorkspaceEntryPayload): SessionGroupInfo[] {
  return data.value.groups.filter((g) => g.workspaceId === ws.id)
}

function belongsTo(sessionId: string, groupId: string | null): boolean {
  const gid = data.value.groupMap[sessionId]
  return gid === undefined ? groupId === null : gid === groupId
}

function ungroupedSessions(ws: WorkspaceEntryPayload): WorkspaceSessionEntry[] {
  return ws.sessions.filter((s) => {
    const gid = data.value.groupMap[s.id]
    return gid === undefined || gid === null
  })
}

function filterSessions<T extends { title: string }>(list: T[]): T[] {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((s) => s.title.toLowerCase().includes(q))
}

// ---------- 工作区操作 ----------
function guestAction(action: string, payload?: unknown): void {
  window.dispatchEvent(new CustomEvent('dshw:guest-action', { detail: { action, payload } }))
}

const VIEW_GROUPS = [
  { group: '分组方式', items: [{ value: 'workspace', label: '按工作区' }, { value: 'flat', label: '单列表' }] },
  { group: '排序方式', items: [{ value: 'manual', label: '手动排序' }, { value: 'updated', label: '最近更新' }] }
]

async function openWorkspace(): Promise<void> {
  const result = await window.dshw.openWorkspaceFolder()
  if (!result.ok) ElMessage.error(result.error ?? '打开工作文件夹失败')
}

async function importSessions(mode: 'folder' | 'file', targetWorkspacePath?: string): Promise<void> {
  importing.value = true
  try {
    const result = await window.dshw.importSessions(mode, targetWorkspacePath)
    if (result.ok) {
      const skip = result.skipped && result.skipped > 0 ? `，${result.skipped} 个已存在跳过` : ''
      ElMessage.success(`已导入 ${result.count} 个会话${skip}`)
    } else if (!result.canceled) {
      ElMessage.error(result.error ?? '导入失败')
    }
  } finally {
    importing.value = false
  }
}

/** 打开指定工作区的文件夹（资源管理器）。 */
async function openWorkspacePath(wsPath: string): Promise<void> {
  if (!wsPath) return
  const result = await window.dshw.openPath(wsPath)
  if (!result.ok) ElMessage.error(result.error ?? '打开失败')
}

async function startChat(): Promise<void> {
  if (service.status !== 'running') {
    const result = await service.start()
    if (!result.ok && result.error) {
      ElMessage.error(result.error)
      return
    }
  }
  window.dispatchEvent(new CustomEvent('dshw:new-chat'))
}

function openSession(session: WorkspaceSessionEntry): void {
  window.dispatchEvent(new CustomEvent('dshw:guest-action', { detail: { action: 'open-session', payload: { id: session.id, title: session.title } } }))
}

// ---------- 工作区动作 ----------
async function renameWorkspaceItem(ws: WorkspaceEntryPayload): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(`重命名工作区「${ws.title}」：`, '重命名工作区', {
      confirmButtonText: '确定', cancelButtonText: '取消', inputValue: ws.title,
      inputValidator: (v: string) => (v.trim() ? true : '名称不能为空')
    })
    const result = await window.dshw.renameWorkspace(ws.id, value)
    if (result.ok) { ElMessage.success('已重命名'); await refreshData() }
    else ElMessage.error(result.error ?? '重命名失败')
  } catch { /* 取消 */ }
}

async function deleteWorkspaceItem(ws: WorkspaceEntryPayload): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除工作区「${ws.title}」？其下 ${ws.sessionCount} 个会话记录也会被移除（无法恢复）。`, '删除工作区', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
    const result = await window.dshw.deleteWorkspace(ws.id)
    if (result.ok) { ElMessage.success('已删除'); await refreshData() }
    else ElMessage.error(result.error ?? '删除失败')
  } catch { /* 取消 */ }
}

async function createGroup(ws: WorkspaceEntryPayload): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(`在「${ws.title}」下新建对话分组：`, '新建分组', {
      confirmButtonText: '创建', cancelButtonText: '取消',
      inputValidator: (v: string) => (v.trim() ? true : '名称不能为空')
    })
    const result = await window.dshw.createSessionGroup(value, ws.id)
    if (result.ok) { ElMessage.success('已创建分组'); await refreshData() }
    else ElMessage.error(result.error ?? '创建失败')
  } catch { /* 取消 */ }
}

async function renameGroupItem(g: SessionGroupInfo): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(`重命名分组「${g.name}」：`, '重命名分组', {
      confirmButtonText: '确定', cancelButtonText: '取消', inputValue: g.name,
      inputValidator: (v: string) => (v.trim() ? true : '名称不能为空')
    })
    const result = await window.dshw.renameSessionGroup(g.id, value)
    if (result.ok) { ElMessage.success('已重命名'); await refreshData() }
    else ElMessage.error(result.error ?? '重命名失败')
  } catch { /* 取消 */ }
}

async function pinGroupItem(g: SessionGroupInfo): Promise<void> {
  const result = await window.dshw.pinSessionGroup(g.id)
  if (result.ok) { ElMessage.success(g.pinned ? '已取消置顶' : '已置顶此分组'); await refreshData() }
  else ElMessage.error(result.error ?? '操作失败')
}

async function deleteGroupItem(g: SessionGroupInfo): Promise<void> {
  try {
    const res = (await ElMessageBox.confirm(
      `删除分组「${g.name}」？`,
      '删除分组',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        checkboxMessage: '同时删除分组内全部会话（不勾选则会话移回工作文件夹）',
        checkboxChecked: false
      } as ElMessageBoxOptions
    )) as unknown as { value?: boolean }
    const deleteContents = res?.value === true
    const result = await window.dshw.deleteSessionGroup(g.id, deleteContents)
    if (result.ok) {
      ElMessage.success(deleteContents ? `已删除分组及 ${result.count ?? 0} 个会话` : '已删除，会话已移回工作文件夹')
      await refreshData()
    } else ElMessage.error(result.error ?? '删除失败')
  } catch { /* 取消 */ }
}

async function moveSessionToGroup(sessionId: string, groupId: string | null): Promise<void> {
  const result = await window.dshw.moveSessionToGroup(sessionId, groupId)
  if (result.ok) { await refreshData() }
  else ElMessage.error(result.error ?? '移动失败')
}

async function toggleFavorite(sessionId: string, favorite: boolean): Promise<void> {
  const result = await window.dshw.setSessionFavorite(sessionId, !favorite)
  if (result.ok) await refreshData()
  else ElMessage.error(result.error ?? '操作失败')
}

async function renameSessionItem(session: WorkspaceSessionEntry): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(`重命名会话「${session.title}」：`, '重命名会话', {
      confirmButtonText: '确定', cancelButtonText: '取消', inputValue: session.title,
      inputValidator: (v: string) => (v.trim() ? true : '名称不能为空')
    })
    const result = await window.dshw.renameSession(session.id, value)
    if (result.ok) { ElMessage.success('已重命名'); await refreshData() }
    else ElMessage.error(result.error ?? '重命名失败（需 dsh 服务运行）')
  } catch { /* 取消 */ }
}

async function forkSessionItem(session: WorkspaceSessionEntry): Promise<void> {
  const result = await window.dshw.forkSession(session.id)
  if (result.ok) {
    ElMessage.success('已创建分叉会话')
    if (result.forkedId) window.dispatchEvent(new CustomEvent('dshw:new-chat'))
  } else {
    ElMessage.error(result.error ?? '分叉失败（需 dsh 服务运行）')
  }
}

async function archiveSessionItem(session: WorkspaceSessionEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(`归档会话「${session.title}」？将移动到归档目录（年/月/日），并出现在侧边栏「归档」区块。`, '归档会话', {
      confirmButtonText: '归档', cancelButtonText: '取消'
    })
    const result = await window.dshw.archiveSession(session.id, session.title, session.time)
    if (result.ok) { ElMessage.success('已归档'); await refreshData() }
    else ElMessage.error(result.error ?? '归档失败')
  } catch { /* 取消 */ }
}

async function deleteArchivedItem(a: ArchivedSessionEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除归档会话「${a.title}」？其文件将被永久删除。`, '删除归档会话', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
    const result = await window.dshw.deleteArchivedSession(a.sessionId)
    if (result.ok) { ElMessage.success('已删除'); await refreshData() }
    else ElMessage.error(result.error ?? '删除失败')
  } catch { /* 取消 */ }
}

/** 移动到分组：弹出分组选择列表（未分组 / 各分组）。 */
function pickGroup(sessionId: string, title: string): void {
  const current = data.value.groupMap[sessionId] ?? null
  let selected = current ?? ''
  const select = h(
    ElSelect,
    {
      modelValue: selected,
      'onUpdate:modelValue': (v: string) => {
        selected = v
      },
      style: { width: '100%', marginTop: '8px' }
    },
    () => [
      h(ElOption, { label: '未分组', value: '' }),
      ...data.value.groups.map((g) => h(ElOption, { label: g.name, value: g.id }))
    ]
  )
  ElMessageBox({
    title: `移动「${title}」到分组`,
    message: h('div', [
      h('div', { style: 'font-size:12px;color:#8a8f98;margin-bottom:4px' }, '选择目标分组：'),
      select
    ]),
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    beforeClose: (action, _instance, done) => {
      if (action === 'confirm') {
        void moveSessionToGroup(sessionId, selected === '' ? null : selected)
        done()
      } else {
        done()
      }
    }
  }).catch(() => undefined)
}

/** 执行导入（mode: folder | file，定向到指定工作区）。 */
async function doImportToWorkspace(ws: WorkspaceEntryPayload, mode: 'folder' | 'file'): Promise<void> {
  importing.value = true
  try {
    const result = await window.dshw.importSessions(mode, ws.path)
    if (result.ok) {
      const skip = result.skipped && result.skipped > 0 ? `，${result.skipped} 个已存在跳过` : ''
      ElMessage.success(`已导入 ${result.count} 个会话${skip}`)
    } else if (!result.canceled) {
      ElMessage.error(result.error ?? '导入失败')
    }
  } finally {
    importing.value = false
    await refreshData()
  }
}

/** 导入会话：先选择「文件夹 / 会话文件」模式（均可多选，压缩包自动解压）。 */
function pickImportMode(ws: WorkspaceEntryPayload): void {
  importTargetWs.value = ws
  importMode.value = 'folder'
  importDialog.value = true
}

async function confirmImport(): Promise<void> {
  const ws = importTargetWs.value
  if (!ws) return
  importDialog.value = false
  await doImportToWorkspace(ws, importMode.value)
}

/** 工作区右键菜单命令。 */
async function workspaceCmd(cmd: string, ws: WorkspaceEntryPayload): Promise<void> {
  if (cmd === 'rename') return renameWorkspaceItem(ws)
  if (cmd === 'delete') return deleteWorkspaceItem(ws)
  if (cmd === 'new-group') return createGroup(ws)
  if (cmd === 'open') return openWorkspacePath(ws.path)
  if (cmd === 'import') pickImportMode(ws)
}

/** 会话右键菜单命令（日常）。 */
async function sessionCmd(cmd: string, session: WorkspaceSessionEntry, _groupId: string | null): Promise<void> {
  if (cmd === 'rename') return renameSessionItem(session)
  if (cmd === 'fork') return forkSessionItem(session)
  if (cmd === 'archive') return archiveSessionItem(session)
  if (cmd === 'favorite') return toggleFavorite(session.id, favorites.value.has(session.id))
  if (cmd === 'move') pickGroup(session.id, session.title)
  if (cmd === 'back-to-workspace') return backToWorkspace(session)
  if (cmd === 'export') return exportSessionItem(session)
  if (cmd === 'delete') return deleteSessionItem(session)
}

/** 返回工作区：移出分组（回到未分组）。 */
async function backToWorkspace(session: WorkspaceSessionEntry): Promise<void> {
  const result = await window.dshw.moveSessionToGroup(session.id, null)
  if (result.ok) {
    ElMessage.success(`「${session.title}」已移回工作文件夹`)
    await refreshData()
  } else ElMessage.error(result.error ?? '操作失败')
}

/** 删除未归档会话（单条，带确认）。 */
async function deleteSessionItem(session: WorkspaceSessionEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除会话「${session.title}」？相关文件将被永久删除。`, '删除会话', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
  } catch {
    return
  }
  const result = await window.dshw.deleteSessions([session.id])
  if (result.ok) { ElMessage.success('已删除'); await refreshData() }
  else ElMessage.error(result.error ?? '删除失败')
}

/** 导出会话：调用 dsh 官方导出（含子代理与附件）保存 ZIP。 */
async function exportSessionItem(session: WorkspaceSessionEntry): Promise<void> {
  exportingSession.value = true
  try {
    const result = await window.dshw.exportSession(session.id, session.title)
    if (result.ok) {
      ElMessage.success('会话已导出')
    } else if (!result.canceled) {
      ElMessage.error(result.error ?? '导出失败')
    }
  } finally {
    exportingSession.value = false
  }
}

/** 归档会话右键菜单命令。 */
async function archiveCmd(cmd: string, a: ArchivedSessionEntry): Promise<void> {
  if (cmd === 'favorite') return toggleFavorite(a.sessionId, favorites.value.has(a.sessionId))
  if (cmd === 'delete') return deleteArchivedItem(a)
  if (cmd === 'move') pickGroup(a.sessionId, a.title)
  if (cmd === 'unarchive') return unarchiveItem(a)
  if (cmd === 'export') return exportSessionItem({ id: a.sessionId, title: a.title, time: a.time })
}

/** 还原到工作区（取消归档）。 */
async function unarchiveItem(a: ArchivedSessionEntry): Promise<void> {
  const result = await window.dshw.unarchiveSession(a.sessionId)
  if (result.ok) {
    ElMessage.success(`「${a.title}」已还原到工作区`)
    await refreshData()
  } else ElMessage.error(result.error ?? '还原失败')
}

// ---------- 归档搜索 ----------
const filteredArchived = computed(() => {
  const kw = archiveKeyword.value.trim().toLowerCase()
  const tm = archiveTime.value.trim()
  return data.value.archived.filter((a) => {
    if (kw) {
      const hit = a.title.toLowerCase().includes(kw) || a.keywords.some((k) => k.toLowerCase().includes(kw))
      if (!hit) return false
    }
    if (tm) {
      const d = new Date(a.time)
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const y = String(d.getFullYear())
      if (!(ymd.includes(tm) || ym.includes(tm) || y.includes(tm))) return false
    }
    return true
  })
})

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

onMounted(() => {
  const sv = (appStore.config?.sidebarView ?? {}) as { groupBy?: unknown; orderBy?: unknown }
  if (sv.groupBy === 'flat') viewMode.value.groupBy = 'flat'
  if (sv.orderBy === 'manual') viewMode.value.orderBy = 'manual'
  void refreshData()
  // 重命名等操作后（含从 dsh 端发起）刷新侧边栏数据
  window.addEventListener('dshw:sidebar-data-changed', refreshData)
})

onBeforeUnmount(() => {
  window.removeEventListener('dshw:sidebar-data-changed', refreshData)
})

const statusText = computed(() => {
  switch (service.status) {
    case 'running':
      return `服务运行中${service.port ? ` · ${service.port}` : ''}`
    case 'starting':
      return '服务启动中…'
    case 'error':
      return '服务异常'
    default:
      return '服务未启动'
  }
})

const SETTING_ITEMS = [
  { key: 'general', name: '通用设置', desc: '语言 / 外观 / Agent 预设', icon: Setting },
  { key: 'env', name: '环境检测', desc: '检测与一键安装 Node/Git/pnpm/dsh', icon: Monitor },
  { key: 'workspace', name: '工作文件夹', desc: '路径 / 迁移 / 数据目录', icon: FolderOpened },
  { key: 'service', name: '服务与运行', desc: '端口 / 启动参数 / 开机自启', icon: Connection },
  { key: 'api', name: '模型与 API', desc: 'API Key / 模型 / 提供方', icon: Key },
  { key: 'plugins', name: '插件', desc: '功能插件 / 在线插件市场 / 推荐技能', icon: Grid },
  { key: 'backup', name: '备份与恢复', desc: '一键备份 / 自动备份 / 导出', icon: DataAnalysis },
  { key: 'sync', name: '异地同步', desc: 'A/B 电脑之间同步会话', icon: RefreshLeft },
  { key: 'about', name: '日志与关于', desc: '日志 / 版本 / 初始化', icon: Document }
]
</script>

<template>
  <aside
    class="relative flex h-full flex-col overflow-hidden border-r border-gray-100 bg-white transition-[width] duration-200 ease-in-out dark:border-[#23262C] dark:bg-[#15171B]"
    :style="{ width: collapsed ? '48px' : '260px' }"
  >
    <!-- 顶部品牌渐变条 -->
    <div class="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#1E2A78] via-[#3B82F6] to-[#6E87FF]"></div>

    <!-- 顶部：Logo + 应用名 + 新建对话 -->
    <div class="flex h-14 shrink-0 items-center gap-2 px-3">
      <AppLogo class="shrink-0" :size="30" />
      <div v-if="!collapsed" class="min-w-0 flex-1 pl-1">
        <div class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">DSH 桌面</div>
        <div class="truncate text-[11px] leading-tight text-gray-400 dark:text-gray-600">DeepSeek Harness 桌面客户端</div>
      </div>
      <el-tooltip v-if="!collapsed && ui.sidebarView === 'chat'" content="新建对话（Ctrl+N）" placement="right">
        <el-button type="primary" circle size="small" aria-label="新建对话" @click="ui.newChat()">
          <el-icon><Plus /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <!-- 中部 -->
    <div class="flex min-h-0 flex-1 flex-col px-2 py-2">
      <template v-if="ui.sidebarView === 'chat'">
        <!-- 收起态：顶部竖排工作区图标 -->
        <div v-if="collapsed" class="flex shrink-0 flex-col items-center gap-1 border-b border-gray-100 pb-2 dark:border-[#23262C]">
          <el-tooltip content="新建会话" placement="right">
            <el-button text circle aria-label="新建会话" class="!m-0" @click="guestAction('new-session')">
              <el-icon :size="17"><Plus /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="添加工作区" placement="right">
            <el-button text circle aria-label="添加工作区" class="!m-0" @click="guestAction('add-workspace')">
              <el-icon :size="17"><FolderAdd /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="搜索会话" placement="right">
            <el-button text circle aria-label="搜索会话" class="!m-0" @click="searchOpen = !searchOpen; ui.setSidebarView('chat')">
              <el-icon :size="17"><Search /></el-icon>
            </el-button>
          </el-tooltip>
        </div>

        <div v-else class="flex h-full flex-col">
          <!-- 顶部子导航：日常工作 / 归档 -->
          <div class="mb-2 flex shrink-0 rounded-lg bg-gray-50 p-0.5 dark:bg-[#1D2026]">
            <button
              class="flex-1 rounded-md py-1 text-xs font-medium transition-colors"
              :class="chatSubView === 'daily' ? 'bg-white text-gray-900 shadow-sm dark:bg-[#2A2D35] dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'"
              @click="chatSubView = 'daily'"
            >
              日常工作
            </button>
            <button
              class="flex-1 rounded-md py-1 text-xs font-medium transition-colors"
              :class="chatSubView === 'archive' ? 'bg-white text-gray-900 shadow-sm dark:bg-[#2A2D35] dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'"
              @click="chatSubView = 'archive'"
            >
              归档
              <span v-if="data.archived.length > 0" class="ml-1 text-[10px] opacity-70">{{ data.archived.length }}</span>
            </button>
          </div>

          <!-- ===== 日常工作 ===== -->
          <template v-if="chatSubView === 'daily'">
            <div class="flex min-h-0 flex-1 flex-col">
              <!-- 工作区操作行 -->
              <div class="mb-2 flex shrink-0 items-center gap-1 rounded-lg border border-gray-100 p-1.5 dark:border-[#23262C]">
                <span class="min-w-0 flex-1 truncate pl-1 text-[10px] text-gray-400 dark:text-gray-600">工作区</span>
                <el-tooltip content="新建会话" placement="right">
                  <el-button text circle aria-label="新建会话" @click="guestAction('new-session')">
                    <el-icon :size="16"><Plus /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="添加工作区" placement="right">
                  <el-button text circle aria-label="添加工作区" @click="guestAction('add-workspace')">
                    <el-icon :size="16"><FolderAdd /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="搜索会话" placement="right">
                  <el-button text circle aria-label="搜索会话" @click="searchOpen = !searchOpen">
                    <el-icon :size="16"><Search /></el-icon>
                  </el-button>
                </el-tooltip>
                <div class="mx-1 h-4 w-px bg-gray-200 dark:bg-[#2A2E35]"></div>
                <!-- 多选模式 -->
                <el-tooltip content="多选（批量删除）" placement="right">
                  <el-button
                    text
                    circle
                    aria-label="多选"
                    :class="{ 'text-brand': selectMode === 'daily' }"
                    @click="selectMode === 'daily' ? exitSelect() : enterSelect('daily')"
                  >
                    <el-icon :size="16"><List /></el-icon>
                  </el-button>
                </el-tooltip>
                <!-- 视图选项（对桌面侧边栏生效 + 同步 dsh） -->
                <el-dropdown
                  trigger="click"
                  popper-class="sidebar-view-options"
                  @command="(v: string) => { const [g, val] = v.split(':'); applyViewOption(g, val) }"
                >
                  <el-button text circle aria-label="视图选项" title="视图选项：分组方式 / 排序方式">
                    <el-icon :size="16"><DataAnalysis /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <template v-for="g in VIEW_GROUPS" :key="g.group">
                        <el-dropdown-item disabled class="!text-[11px] !text-gray-400">{{ g.group }}</el-dropdown-item>
                        <el-dropdown-item
                          v-for="m in g.items"
                          :key="m.value"
                          :command="`${g.group}:${m.value}`"
                          :class="{ 'text-brand': (g.group === '分组方式' ? viewMode.groupBy : viewMode.orderBy) === m.value }"
                        >
                          {{ m.label }}
                          <el-icon v-if="(g.group === '分组方式' ? viewMode.groupBy : viewMode.orderBy) === m.value" class="ml-1"><CircleCheckFilled /></el-icon>
                        </el-dropdown-item>
                      </template>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>

              <!-- 搜索框（桌面端过滤） -->
              <div v-if="searchOpen" class="mb-2 shrink-0">
                <el-input v-model="searchText" size="small" placeholder="搜索会话标题…" clearable autofocus />
              </div>

              <!-- 多选操作条 -->
              <div v-if="selectMode === 'daily'" class="mb-2 flex shrink-0 items-center gap-1 rounded-lg border border-brand/30 bg-brand/5 p-1.5 dark:border-brand/40 dark:bg-brand/10">
                <span class="min-w-0 flex-1 truncate pl-1 text-[11px] text-gray-600 dark:text-gray-300">
                  {{ selectedIds.size + selectedGroupIds.size }} 项已选
                </span>
                <el-button size="small" text @click="selectAllVisible()">全选</el-button>
                <el-button size="small" text type="danger" :disabled="selectedIds.size === 0" @click="deleteSelected()">删除会话</el-button>
                <el-button size="small" text type="danger" :disabled="selectedGroupIds.size === 0" @click="deleteSelectedGroups()">删除分组</el-button>
                <el-button size="small" text @click="exitSelect()">退出</el-button>
              </div>

              <!-- 服务状态 -->
              <div class="mb-2 shrink-0 rounded-lg border border-gray-100 p-2 dark:border-[#23262C]">
                <div class="flex items-center gap-2">
                  <span class="status-dot" :class="`status-dot--${service.status}`"></span>
                  <span class="min-w-0 flex-1 truncate text-[11px] text-gray-600 dark:text-gray-300">{{ statusText }}</span>
                  <el-button
                    size="small"
                    :type="service.status === 'stopped' ? 'primary' : 'default'"
                    aria-label="启动或停止服务"
                    :loading="service.starting || service.stopping"
                    @click="ui.toggleService()"
                  >
                    {{ service.status === 'stopped' ? '启动' : '停止' }}
                  </el-button>
                </div>
              </div>

              <el-button type="primary" size="small" class="mb-2 w-full shrink-0" @click="startChat()">
                <el-icon class="mr-1"><VideoPlay /></el-icon>
                开始对话
              </el-button>

              <!-- 会话树：按工作区（含分组）或 单列表 -->
              <div class="min-h-0 flex-1 overflow-y-auto">
                <div v-if="!wsLoaded" class="py-4 text-center text-[11px] text-gray-400 dark:text-gray-600">加载中…</div>
                <div v-else-if="data.workspaces.length === 0" class="py-4 text-center text-[11px] text-gray-400 dark:text-gray-600">
                  暂无工作区，点击上方「+」开始第一次对话。
                </div>

                <!-- 单列表模式 -->
                <div v-else-if="viewMode.groupBy === 'flat'" class="space-y-0.5">
                  <div class="mb-1 px-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-600">
                    全部会话 · {{ flatSessions.length }}
                  </div>
                  <div
                    v-for="s in filterSessions(flatSessions)"
                    :key="s.id"
                    class="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-[#1D2026] dark:hover:text-gray-200"
                    :class="{ 'bg-brand/10 dark:bg-brand/15': selectedIds.has(s.id) }"
                    :title="selectMode === 'daily' ? '点击勾选' : '点击打开会话'"
                    @click="selectMode === 'daily' ? toggleSelect(s.id) : openSession(s)"
                  >
                    <el-checkbox
                      v-if="selectMode === 'daily'"
                      :model-value="selectedIds.has(s.id)"
                      size="small"
                      class="!mr-0 shrink-0"
                      @click.stop
                      @change="(v: boolean) => markSelect(s.id, v)"
                    />
                    <el-icon v-if="favorites.has(s.id)" :size="12" class="shrink-0 text-yellow-400"><StarFilled /></el-icon>
                    <el-icon v-else :size="12" class="shrink-0 text-gray-300 dark:text-gray-600"><ChatDotRound /></el-icon>
                    <span class="min-w-0 flex-1 truncate">{{ s.title }}</span>
                    <span class="shrink-0 text-[9px] text-gray-300 dark:text-gray-600">{{ s.wsTitle }}</span>
                    <el-dropdown trigger="click" @command="(cmd: string) => sessionCmd(cmd, s, null)" @click.stop>
                      <el-button text circle size="small" class="!m-0 opacity-0 group-hover:opacity-100" aria-label="会话操作">
                        <el-icon :size="13"><MoreFilled /></el-icon>
                      </el-button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="rename" :icon="EditPen">重命名会话</el-dropdown-item>
                          <el-dropdown-item command="fork" :icon="CopyDocument">分叉会话</el-dropdown-item>
                          <el-dropdown-item command="archive" :icon="Folder">归档会话</el-dropdown-item>
                          <el-dropdown-item command="favorite" :icon="Star">{{ favorites.has(s.id) ? '取消收藏' : '收藏' }}</el-dropdown-item>
                          <el-dropdown-item v-if="data.groupMap[s.id]" command="back-to-workspace" :icon="Back" divided>返回工作区</el-dropdown-item>
                          <el-dropdown-item command="move" :icon="CollectionTag">移动到分组…</el-dropdown-item>
                          <el-dropdown-item command="export" :icon="Download">导出会话</el-dropdown-item>
                          <el-dropdown-item command="delete" :icon="Delete" divided>删除会话</el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                  <div v-if="filterSessions(flatSessions).length === 0" class="px-2 py-2 text-[10px] text-gray-400 dark:text-gray-600">没有匹配的会话</div>
                </div>

                <!-- 按工作区模式 -->
                <div v-else class="space-y-0.5">
                  <div v-for="ws in data.workspaces" :key="ws.id" class="rounded-lg">
                    <!-- 工作区标题行 -->
                    <div class="group flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 hover:bg-gray-50 dark:hover:bg-[#1D2026]" @click="toggleSet(expandedWs, ws.id)">
                      <el-icon :size="13" class="shrink-0 text-gray-400 dark:text-gray-500">
                        <ArrowDownIcon v-if="isWsExpanded(ws.id)" /><ArrowRight v-else />
                      </el-icon>
                      <el-icon :size="14" class="shrink-0 text-gray-400 dark:text-gray-500"><FolderOpened /></el-icon>
                      <span class="min-w-0 flex-1 truncate text-xs font-medium text-gray-700 dark:text-gray-200">{{ ws.title }}</span>
                      <span class="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">{{ ws.sessionCount }}</span>
                      <el-dropdown trigger="click" @command="(cmd: string) => workspaceCmd(cmd, ws)" @click.stop>
                        <el-button text circle size="small" class="!m-0 opacity-0 group-hover:opacity-100" aria-label="工作区操作">
                          <el-icon :size="14"><MoreFilled /></el-icon>
                        </el-button>
                        <template #dropdown>
                          <el-dropdown-menu>
                            <el-dropdown-item command="import" :icon="Upload">导入会话（到本工作区）</el-dropdown-item>
                            <el-dropdown-item command="open" :icon="FolderOpened">打开工作文件夹</el-dropdown-item>
                            <el-dropdown-item command="new-group" :icon="CollectionTag">新建分组</el-dropdown-item>
                            <el-dropdown-item command="rename" :icon="EditPen" divided>重命名工作区</el-dropdown-item>
                            <el-dropdown-item command="delete" :icon="Delete">删除工作区</el-dropdown-item>
                          </el-dropdown-menu>
                        </template>
                      </el-dropdown>
                    </div>

                    <div v-if="isWsExpanded(ws.id)" class="ml-3 space-y-0.5 border-l border-gray-100 pl-2 dark:border-[#23262C]">
                      <!-- 分组 -->
                      <div v-for="g in groupsOf(ws)" :key="g.id" class="rounded-md">
                        <div class="group flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 hover:bg-gray-50 dark:hover:bg-[#1D2026]" :class="{ 'bg-brand/10 dark:bg-brand/15': selectedGroupIds.has(g.id) }" @click="selectMode === 'daily' ? toggleGroupSelect(g.id) : toggleSet(expandedGroups, g.id)">
                          <el-checkbox
                            v-if="selectMode === 'daily'"
                            :model-value="selectedGroupIds.has(g.id)"
                            size="small"
                            class="!mr-0 shrink-0"
                            @click.stop
                            @change="(v: boolean) => markGroupSelect(g.id, v)"
                          />
                          <el-icon :size="12" class="shrink-0 text-gray-400 dark:text-gray-500" @click.stop="toggleSet(expandedGroups, g.id)">
                            <ArrowDownIcon v-if="isGroupExpanded(g.id)" /><ArrowRight v-else />
                          </el-icon>
                          <el-icon :size="13" class="shrink-0" :class="g.pinned ? 'text-brand' : 'text-gray-400 dark:text-gray-500'"><Folder /></el-icon>
                          <el-icon v-if="g.pinned" :size="12" class="shrink-0 text-yellow-400"><StarFilled /></el-icon>
                          <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-600 dark:text-gray-300">{{ g.name }}</span>
                          <span class="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">{{ ws.sessions.filter((s) => belongsTo(s.id, g.id)).length }}</span>
                          <el-dropdown trigger="click" @command="(cmd: string) => cmd === 'rename' ? renameGroupItem(g) : cmd === 'pin' ? pinGroupItem(g) : deleteGroupItem(g)" @click.stop>
                            <el-button text circle size="small" class="!m-0 opacity-0 group-hover:opacity-100" aria-label="分组操作">
                              <el-icon :size="13"><MoreFilled /></el-icon>
                            </el-button>
                            <template #dropdown>
                              <el-dropdown-menu>
                                <el-dropdown-item command="rename" :icon="EditPen">重命名分组</el-dropdown-item>
                                <el-dropdown-item command="pin" :icon="Aim">{{ g.pinned ? '取消置顶' : '置顶此分组' }}</el-dropdown-item>
                                <el-dropdown-item command="delete" :icon="Delete" divided>删除分组</el-dropdown-item>
                              </el-dropdown-menu>
                            </template>
                          </el-dropdown>
                        </div>
                        <div v-if="isGroupExpanded(g.id)" class="ml-3 space-y-0.5 border-l border-gray-100 pl-2 dark:border-[#23262C]">
                          <div v-for="s in filterSessions(sortSessions(ws.sessions.filter((x) => belongsTo(x.id, g.id))))" :key="s.id" class="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-[#1D2026] dark:hover:text-gray-200" :class="{ 'bg-brand/10 dark:bg-brand/15': selectedIds.has(s.id) }" :title="selectMode === 'daily' ? '点击勾选' : '点击打开会话'" @click="selectMode === 'daily' ? toggleSelect(s.id) : openSession(s)">
                            <el-checkbox
                              v-if="selectMode === 'daily'"
                              :model-value="selectedIds.has(s.id)"
                              size="small"
                              class="!mr-0 shrink-0"
                              @click.stop
                              @change="(v: boolean) => markSelect(s.id, v)"
                            />
                            <el-icon v-if="favorites.has(s.id)" :size="12" class="shrink-0 text-yellow-400"><StarFilled /></el-icon>
                            <el-icon v-else :size="12" class="shrink-0 text-gray-300 dark:text-gray-600"><ChatDotRound /></el-icon>
                            <span class="min-w-0 flex-1 truncate">{{ s.title }}</span>
                            <el-dropdown trigger="click" @command="(cmd: string) => sessionCmd(cmd, s, null)" @click.stop>
                              <el-button text circle size="small" class="!m-0 opacity-0 group-hover:opacity-100" aria-label="会话操作">
                                <el-icon :size="13"><MoreFilled /></el-icon>
                              </el-button>
                              <template #dropdown>
                                <el-dropdown-menu>
                                  <el-dropdown-item command="rename" :icon="EditPen">重命名会话</el-dropdown-item>
                                  <el-dropdown-item command="fork" :icon="CopyDocument">分叉会话</el-dropdown-item>
                                  <el-dropdown-item command="archive" :icon="Folder">归档会话</el-dropdown-item>
                                  <el-dropdown-item command="favorite" :icon="Star">{{ favorites.has(s.id) ? '取消收藏' : '收藏' }}</el-dropdown-item>
                                  <el-dropdown-item command="back-to-workspace" :icon="Back" divided>返回工作区</el-dropdown-item>
                                  <el-dropdown-item command="move" :icon="CollectionTag">移动到分组…</el-dropdown-item>
                                  <el-dropdown-item command="export" :icon="Download">导出会话</el-dropdown-item>
                                  <el-dropdown-item command="delete" :icon="Delete" divided>删除会话</el-dropdown-item>
                                </el-dropdown-menu>
                              </template>
                            </el-dropdown>
                          </div>
                          <div v-if="filterSessions(sortSessions(ws.sessions.filter((x) => belongsTo(x.id, g.id)))).length === 0" class="px-2 py-1 text-[10px] text-gray-400 dark:text-gray-600">空分组</div>
                        </div>
                      </div>

                      <!-- 未分组 -->
                      <div v-if="ungroupedSessions(ws).length > 0 || groupsOf(ws).length === 0" class="rounded-md">
                        <div v-for="s in filterSessions(sortSessions(ungroupedSessions(ws)))" :key="s.id" class="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-[#1D2026] dark:hover:text-gray-200" :class="{ 'bg-brand/10 dark:bg-brand/15': selectedIds.has(s.id) }" :title="selectMode === 'daily' ? '点击勾选' : '点击打开会话'" @click="selectMode === 'daily' ? toggleSelect(s.id) : openSession(s)">
                          <el-checkbox
                            v-if="selectMode === 'daily'"
                            :model-value="selectedIds.has(s.id)"
                            size="small"
                            class="!mr-0 shrink-0"
                            @click.stop
                            @change="(v: boolean) => markSelect(s.id, v)"
                          />
                          <el-icon v-if="favorites.has(s.id)" :size="12" class="shrink-0 text-yellow-400"><StarFilled /></el-icon>
                          <el-icon v-else :size="12" class="shrink-0 text-gray-300 dark:text-gray-600"><ChatDotRound /></el-icon>
                          <span class="min-w-0 flex-1 truncate">{{ s.title }}</span>
                          <el-dropdown trigger="click" @command="(cmd: string) => sessionCmd(cmd, s, null)" @click.stop>
                            <el-button text circle size="small" class="!m-0 opacity-0 group-hover:opacity-100" aria-label="会话操作">
                              <el-icon :size="13"><MoreFilled /></el-icon>
                            </el-button>
                            <template #dropdown>
                              <el-dropdown-menu>
                                <el-dropdown-item command="rename" :icon="EditPen">重命名会话</el-dropdown-item>
                                <el-dropdown-item command="fork" :icon="CopyDocument">分叉会话</el-dropdown-item>
                                <el-dropdown-item command="archive" :icon="Folder">归档会话</el-dropdown-item>
                                <el-dropdown-item command="favorite" :icon="Star">{{ favorites.has(s.id) ? '取消收藏' : '收藏' }}</el-dropdown-item>
                                <el-dropdown-item v-if="data.groupMap[s.id]" command="back-to-workspace" :icon="Back" divided>返回工作区</el-dropdown-item>
                                <el-dropdown-item command="move" :icon="CollectionTag">移动到分组…</el-dropdown-item>
                                <el-dropdown-item command="export" :icon="Download">导出会话</el-dropdown-item>
                                <el-dropdown-item command="delete" :icon="Delete" divided>删除会话</el-dropdown-item>
                              </el-dropdown-menu>
                            </template>
                          </el-dropdown>
                        </div>
                      </div>
                      <div v-if="ws.sessions.length === 0" class="px-2 py-1 text-[10px] text-gray-400 dark:text-gray-600">暂无会话</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- ===== 归档 ===== -->
          <template v-else>
            <div class="flex min-h-0 flex-1 flex-col">
              <div class="flex items-center gap-1 px-1 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-600">
                <el-icon :size="12"><Folder /></el-icon>
                <span>归档会话</span>
                <span class="ml-auto text-[10px] text-gray-300 dark:text-gray-600">{{ filteredArchived.length }} / {{ data.archived.length }}</span>
                <el-tooltip content="多选（批量删除）" placement="right">
                  <el-button text circle size="small" aria-label="多选" :class="{ 'text-brand': selectMode === 'archive' }" @click="selectMode === 'archive' ? exitSelect() : enterSelect('archive')">
                    <el-icon :size="14"><List /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
              <div v-if="selectMode === 'archive'" class="mb-1 flex items-center gap-1 rounded-lg border border-brand/30 bg-brand/5 p-1.5 dark:border-brand/40 dark:bg-brand/10">
                <span class="min-w-0 flex-1 truncate pl-1 text-[11px] text-gray-600 dark:text-gray-300">{{ selectedIds.size }} 项已选</span>
                <el-button size="small" text @click="selectAllVisible()">全选</el-button>
                <el-button size="small" text type="danger" :disabled="selectedIds.size === 0" @click="deleteSelected()">删除</el-button>
                <el-button size="small" text @click="exitSelect()">退出</el-button>
              </div>
              <div class="shrink-0">
                <el-input v-model="archiveKeyword" size="small" placeholder="按关键词搜索…" clearable />
              </div>
              <div class="mt-1 shrink-0">
                <el-input v-model="archiveTime" size="small" placeholder="按时间搜索：2026 / 2026-08 / 2026-08-16" clearable />
              </div>
              <div class="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto">
                <div v-for="a in filteredArchived" :key="a.sessionId" class="group rounded-md border border-gray-100 p-1.5 dark:border-[#23262C]" :class="{ 'bg-brand/10 dark:bg-brand/15': selectedIds.has(a.sessionId) }">
                  <div class="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <el-checkbox
                      v-if="selectMode === 'archive'"
                      :model-value="selectedIds.has(a.sessionId)"
                      size="small"
                      class="!mr-0 shrink-0"
                      @change="(v: boolean) => markSelect(a.sessionId, v)"
                    />
                    <el-icon v-if="favorites.has(a.sessionId)" :size="12" class="shrink-0 text-yellow-400"><StarFilled /></el-icon>
                    <el-icon v-else :size="12" class="shrink-0 text-gray-300 dark:text-gray-600"><Folder /></el-icon>
                    <span class="min-w-0 flex-1 truncate" :title="a.title">{{ a.title }}</span>
                    <el-dropdown trigger="click" @command="(cmd: string) => archiveCmd(cmd, a)" @click.stop>
                      <el-button text circle size="small" class="!m-0 opacity-0 group-hover:opacity-100" aria-label="归档会话操作">
                        <el-icon :size="13"><MoreFilled /></el-icon>
                      </el-button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="unarchive" :icon="Back">还原到工作区</el-dropdown-item>
                          <el-dropdown-item command="favorite" :icon="Star">{{ favorites.has(a.sessionId) ? '取消收藏' : '收藏' }}</el-dropdown-item>
                          <el-dropdown-item command="move" :icon="CollectionTag">移动到分组…</el-dropdown-item>
                          <el-dropdown-item command="export" :icon="Download">导出会话</el-dropdown-item>
                          <el-dropdown-item command="delete" :icon="Delete" divided>删除归档会话</el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                  <div class="mt-1 flex flex-wrap items-center gap-1 pl-4">
                    <span class="rounded bg-gray-100 px-1 py-0.5 text-[9px] text-gray-400 dark:bg-[#1E2126] dark:text-gray-500">{{ fmtDate(a.time) }}</span>
                    <span v-for="k in a.keywords.slice(0, 3)" :key="k" class="rounded bg-gray-100 px-1 py-0.5 text-[9px] text-gray-400 dark:bg-[#1E2126] dark:text-gray-500">#{{ k }}</span>
                  </div>
                </div>
                <div v-if="filteredArchived.length === 0" class="px-2 py-3 text-center text-[10px] text-gray-400 dark:text-gray-600">
                  {{ data.archived.length === 0 ? '暂无归档会话' : '没有匹配的结果' }}
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>

      <!-- 设置视图 -->
      <template v-else-if="!collapsed">
        <button class="mb-2 flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-[#1D2026]" @click="ui.setSidebarView('chat')">
          <el-icon :size="14"><Back /></el-icon>
          返回会话
        </button>
        <div class="mb-2 shrink-0 rounded-lg border border-gray-100 p-2.5 dark:border-[#23262C]">
          <div class="flex items-center gap-2">
            <span class="status-dot" :class="`status-dot--${service.status}`"></span>
            <span class="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-300">{{ statusText }}</span>
            <el-button size="small" :type="service.status === 'stopped' ? 'primary' : 'default'" aria-label="启动或停止服务" :loading="service.starting || service.stopping" @click="ui.toggleService()">
              {{ service.status === 'stopped' ? '启动' : '停止' }}
            </el-button>
          </div>
        </div>
        <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          <button v-for="item in SETTING_ITEMS" :key="item.key" class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-[#1D2026]" @click="ui.openSettings(item.key)">
            <el-icon :size="16" class="shrink-0 text-gray-400 dark:text-gray-500"><component :is="item.icon" /></el-icon>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-medium text-gray-700 dark:text-gray-200">{{ item.name }}</div>
              <div class="truncate text-[10px] text-gray-400 dark:text-gray-600">{{ item.desc }}</div>
            </div>
          </button>
        </div>
      </template>
    </div>

    <!-- 底部 -->
    <div class="shrink-0 border-t border-gray-100 p-2 dark:border-[#23262C]">
      <div v-if="!collapsed" class="mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:text-gray-500 dark:hover:bg-[#1D2026]" :title="appStore.workspacePath || '工作文件夹'" @click="openWorkspace()">
        <el-icon><FolderOpened /></el-icon>
        <span class="truncate">{{ shortWorkspace || '工作文件夹未设置' }}</span>
      </div>
      <div v-if="collapsed" class="flex flex-col items-center gap-1">
        <el-tooltip content="展开任务栏（Ctrl+B）" placement="right">
          <el-button text circle aria-label="收起或展开任务栏" class="!m-0" @click="ui.toggleSidebar()">
            <el-icon :size="17"><Expand /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="打开设置（Ctrl+,）" placement="right">
          <el-button text circle aria-label="打开设置" class="!m-0" :class="{ 'text-brand': ui.sidebarView === 'settings' }" @click="ui.setSidebarView(ui.sidebarView === 'settings' ? 'chat' : 'settings')">
            <el-icon :size="17"><Setting /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip :content="appStore.themeLabel()" placement="right">
          <el-button text circle aria-label="切换主题" class="!m-0" @click="appStore.cycleTheme()">
            <el-icon :size="17">
              <Sunny v-if="appStore.theme === 'light'" /><Moon v-else-if="appStore.theme === 'dark'" /><Monitor v-else />
            </el-icon>
          </el-button>
        </el-tooltip>
      </div>
      <div v-else class="flex items-center justify-between px-1 pt-0.5">
        <el-tooltip :content="ui.sidebarView === 'settings' ? '返回会话' : '打开设置（Ctrl+,）'" placement="right">
          <el-button text circle aria-label="打开设置" :class="{ 'text-brand': ui.sidebarView === 'settings' }" @click="ui.setSidebarView(ui.sidebarView === 'settings' ? 'chat' : 'settings')">
            <el-icon :size="17"><Setting /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip :content="appStore.themeLabel()" placement="right">
          <el-button text circle aria-label="切换主题" @click="appStore.cycleTheme()">
            <el-icon :size="17">
              <Sunny v-if="appStore.theme === 'light'" /><Moon v-else-if="appStore.theme === 'dark'" /><Monitor v-else />
            </el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip :content="collapsed ? '展开任务栏（Ctrl+B）' : '收起任务栏（Ctrl+B）'" placement="right">
          <el-button text circle aria-label="收起或展开任务栏" @click="ui.toggleSidebar()">
            <el-icon :size="17"><Fold v-if="!collapsed" /><Expand v-else /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <!-- 导入会话：模式选择对话框 -->
    <el-dialog
      v-model="importDialog"
      :title="`导入会话到「${importTargetWs?.title ?? ''}」`"
      width="420px"
      append-to-body
    >
      <p class="text-xs text-gray-500 dark:text-gray-400">选择导入方式（压缩包将自动解压）：</p>
      <el-radio-group v-model="importMode" class="mt-3 flex flex-col items-start gap-2">
        <el-radio value="folder">导入会话文件夹（可多选）</el-radio>
        <el-radio value="file">导入会话文件（可多选，支持 .zip / .tar 等压缩包自动解压）</el-radio>
      </el-radio-group>
      <template #footer>
        <el-button size="small" @click="importDialog = false">取消</el-button>
        <el-button size="small" type="primary" :loading="importing" @click="confirmImport()">确定</el-button>
      </template>
    </el-dialog>
  </aside>
</template>
