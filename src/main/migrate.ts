/**
 * M3：存量 dsh 数据扫描与一键迁移（规格 6.8）+ 数据目录自检（规格 4.4）+ DSH_HOME 补丁。
 *
 * 已联网核实：dsh 全部用户数据收敛于 $DSH_HOME（默认 ~/.dsh）：
 *   sessions/（jsonl 会话）、settings.yaml、.credentials.yaml、profiles/、storages/、
 *   skills/（用户技能根，dsh-skill-filesystem 的 user-dsh 根）、cordis.patch.yml（home 级补丁）。
 * 迁移采用「复制」而非「移动」；冲突策略：覆盖 / 跳过 / 重命名。
 * 技能迁移到规格的 workspace/skills/，并通过 $DSH_HOME/cordis.patch.yml 的
 * skill-filesystem.customSkillDirs 指向它（home 补丁机制已从 dsh-app-boot 源码核实）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probeWritable } from '../shared/workspace'
import { loadYamlAny, dumpYaml } from '../shared/yaml'
import type { DshDataDirStatus, DshDataItemKey, DshDataScanItem, DshDataSource, MigrateConflictPolicy, MigrateResult } from '../shared/ipc'

export interface MigrateCallbacks {
  log: (message: string) => void
  progress: (done: number, total: number) => void
  isCancelled: () => boolean
}

export const MIGRATE_ITEM_LABELS: Record<DshDataItemKey, string> = {
  sessions: '对话记录（sessions/*.jsonl）',
  skills: '用户技能（skills/）',
  settings: '模型/API 设置（settings.yaml）',
  credentials: 'API 凭据（.credentials.yaml）',
  profiles: 'profiles（profile 配置）',
  storages: 'storages/（扩展存储）',
  patch: '用户补丁（cordis.patch.yml）'
}

// ---------------------------------------------------------------------------
// 数据目录自检（规格 4.4）
// ---------------------------------------------------------------------------

export function checkDshDataDir(workspaceDir: string): DshDataDirStatus {
  const dataDir = path.join(workspaceDir, 'data')
  const exists = fs.existsSync(dataDir)
  const writable = probeWritable(dataDir).ok
  const status: DshDataDirStatus['status'] = !exists ? 'missing' : !writable ? 'unwritable' : 'ok'
  return { path: dataDir, status, exists, writable }
}

// ---------------------------------------------------------------------------
// 存量数据扫描（规格 6.8）
// ---------------------------------------------------------------------------

/** 候选 dsh 数据源：$DSH_HOME → ~/.dsh → 当前工作文件夹 data/（按解析路径去重）。 */
export function listCandidateDshHomes(workspaceDir: string): Array<{ path: string; label: string; isWorkspaceData: boolean }> {
  const wsData = path.join(workspaceDir, 'data')
  const candidates: Array<{ path: string; label: string; isWorkspaceData: boolean }> = []
  const seen = new Set<string>()
  const push = (p: string, label: string, isWorkspaceData: boolean): void => {
    const resolved = path.resolve(p)
    if (seen.has(resolved)) return
    seen.add(resolved)
    candidates.push({ path: resolved, label, isWorkspaceData })
  }
  const envHome = process.env['DSH_HOME']?.trim()
  if (envHome && path.resolve(envHome) !== wsData) push(envHome, '$DSH_HOME（环境变量）', false)
  if (path.resolve(path.join(os.homedir(), '.dsh')) !== wsData) {
    push(path.join(os.homedir(), '.dsh'), '默认目录（~/.dsh）', false)
  }
  push(wsData, '当前工作文件夹（data/）', true)
  return candidates
}

/** 递归统计会话文件（真实 dsh 布局为嵌套：sessions/<workspace>/<session-id>/session.jsonl[.zstd]）。 */
function countJsonl(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let count = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        count += countJsonl(full)
      } else if (entry.isFile() && /\.jsonl(\.zstd)?$/.test(entry.name)) {
        count += 1
      }
    }
  } catch {
    /* 忽略扫描错误 */
  }
  return count
}

/** 技能计数：目录束（含 SKILL.md）数量 + 顶层扁平 .md 技能数量。 */
function countSkills(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let count = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (fs.existsSync(path.join(dir, entry.name, 'SKILL.md'))) count += 1
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count += 1
      }
    }
  } catch {
    /* 忽略扫描错误 */
  }
  return count
}

function countDirs(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length
  } catch {
    return 0
  }
}

function fileExists(p: string): boolean {
  return fs.existsSync(p) && fs.statSync(p).isFile()
}

function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  try {
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.isFile()) total += fs.statSync(full).size
      }
    }
    walk(dir)
  } catch {
    /* 忽略 */
  }
  return total
}

function scanItem(key: DshDataItemKey, sourcePath: string, count: number, exists: boolean): DshDataScanItem {
  return {
    key,
    label: MIGRATE_ITEM_LABELS[key],
    sourcePath,
    count,
    exists,
    sizeBytes: exists ? dirSize(sourcePath) : 0
  }
}

/** 扫描一个 dsh 数据源；目录不存在返回 null。 */
export function scanDshHome(homePath: string): DshDataSource | null {
  if (!fs.existsSync(homePath)) return null
  const sessionsDir = path.join(homePath, 'sessions')
  const skillsDir = path.join(homePath, 'skills')
  const profilesDir = path.join(homePath, 'profiles')
  const storagesDir = path.join(homePath, 'storages')
  const settingsPath = path.join(homePath, 'settings.yaml')
  const credsPath = path.join(homePath, '.credentials.yaml')
  const patchPath = path.join(homePath, 'cordis.patch.yml')

  const items: DshDataScanItem[] = [
    scanItem('sessions', sessionsDir, countJsonl(sessionsDir), fs.existsSync(sessionsDir)),
    scanItem('skills', skillsDir, countSkills(skillsDir), fs.existsSync(skillsDir)),
    scanItem('settings', settingsPath, fileExists(settingsPath) ? 1 : 0, fileExists(settingsPath)),
    scanItem('credentials', credsPath, fileExists(credsPath) ? 1 : 0, fileExists(credsPath)),
    scanItem('profiles', profilesDir, countDirs(profilesDir), fs.existsSync(profilesDir)),
    scanItem('storages', storagesDir, dirSize(storagesDir) > 0 ? 1 : 0, fs.existsSync(storagesDir)),
    scanItem('patch', patchPath, fileExists(patchPath) ? 1 : 0, fileExists(patchPath))
  ]
  const totalSessions = countJsonl(sessionsDir)
  const totalSkills = countSkills(skillsDir)
  return { path: homePath, label: homePath, isWorkspaceData: false, items, totalSessions, totalSkills }
}

export function scanAllDshHomes(workspaceDir: string): DshDataSource[] {
  return listCandidateDshHomes(workspaceDir)
    .map((c) => {
      const source = scanDshHome(c.path)
      if (!source) return null
      source.label = c.label
      source.isWorkspaceData = c.isWorkspaceData
      return source
    })
    .filter((s): s is DshDataSource => s !== null)
}

// ---------------------------------------------------------------------------
// 迁移计划与冲突（纯逻辑，可单测）
// ---------------------------------------------------------------------------

export interface MigrationEntry {
  key: DshDataItemKey
  relPath: string
  sourceAbs: string
  destAbs: string
}

/** 各数据项到工作文件夹的映射根。 */
function destRootFor(key: DshDataItemKey, workspaceDir: string): string {
  switch (key) {
    case 'sessions':
      return path.join(workspaceDir, 'data', 'sessions')
    case 'skills':
      return path.join(workspaceDir, 'skills')
    case 'settings':
    case 'credentials':
    case 'profiles':
    case 'storages':
      return path.join(workspaceDir, 'data', key === 'settings' ? '' : key === 'credentials' ? '' : key)
    case 'patch':
      return path.join(workspaceDir, 'data')
    default:
      return path.join(workspaceDir, 'data')
  }
}

function walkFiles(dir: string, base: string, out: string[]): void {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(full, base, out)
    else if (e.isFile()) out.push(path.relative(base, full))
  }
}

/**
 * 生成迁移计划（文件级条目）与冲突清单（目标已存在同路径文件）。
 * key 为单个文件时（settings/credentials/patch）视为该文件条目。
 */
export function buildMigrationPlan(
  sourceHome: string,
  workspaceDir: string,
  selection: DshDataItemKey[]
): { entries: MigrationEntry[]; conflicts: string[] } {
  const entries: MigrationEntry[] = []
  for (const key of selection) {
    const destRoot = destRootFor(key, workspaceDir)
    if (key === 'settings') {
      const src = path.join(sourceHome, 'settings.yaml')
      if (fs.existsSync(src)) entries.push({ key, relPath: 'settings.yaml', sourceAbs: src, destAbs: path.join(destRoot, 'settings.yaml') })
      continue
    }
    if (key === 'credentials') {
      const src = path.join(sourceHome, '.credentials.yaml')
      if (fs.existsSync(src)) entries.push({ key, relPath: '.credentials.yaml', sourceAbs: src, destAbs: path.join(destRoot, '.credentials.yaml') })
      continue
    }
    if (key === 'patch') {
      const src = path.join(sourceHome, 'cordis.patch.yml')
      if (fs.existsSync(src)) entries.push({ key, relPath: 'cordis.patch.yml', sourceAbs: src, destAbs: path.join(destRoot, 'cordis.patch.yml') })
      continue
    }
    const srcRoot = path.join(sourceHome, key)
    const files: string[] = []
    walkFiles(srcRoot, srcRoot, files)
    for (const rel of files) {
      entries.push({ key, relPath: rel, sourceAbs: path.join(srcRoot, rel), destAbs: path.join(destRoot, rel) })
    }
  }
  const conflicts = entries.filter((e) => fs.existsSync(e.destAbs)).map((e) => e.relPath)
  return { entries, conflicts }
}

// ---------------------------------------------------------------------------
// DSH_HOME 补丁（workspace/skills 生效的关键）
// ---------------------------------------------------------------------------

/** 合并 YAML 条目列表：按 id 去重（保留最后出现），并保证 skill-filesystem 条目最后（我们的配置生效）。 */
export function mergePatchEntries(
  base: unknown[],
  incoming: unknown[],
  skillEntry: Record<string, unknown>
): unknown[] {
  const byId = new Map<string, unknown>()
  const ordered: unknown[] = []
  const push = (e: unknown): void => {
    const id = e && typeof e === 'object' ? (e as { id?: unknown }).id : undefined
    if (typeof id === 'string') {
      if (byId.has(id)) {
        const idx = ordered.indexOf(byId.get(id))
        ordered[idx] = e
      } else {
        ordered.push(e)
        byId.set(id, e)
      }
    } else {
      ordered.push(e)
    }
  }
  for (const e of [...base, ...incoming]) push(e)
  // 移除旧 skill-filesystem 条目（若存在），追加我们的一份
  const filtered = ordered.filter(
    (e) => !(e && typeof e === 'object' && (e as { id?: unknown }).id === 'skill-filesystem')
  )
  filtered.push(skillEntry)
  return filtered
}

export function dshSkillPatchEntry(workspaceDir: string): Record<string, unknown> {
  return {
    id: 'skill-filesystem',
    config: {
      customSkillDirs: [path.join(workspaceDir, 'skills')]
    }
  }
}

/** 读取工作文件夹 data/cordis.patch.yml（不存在返回 []）。 */
export function readHomePatch(workspaceDir: string): unknown[] {
  const patchPath = path.join(workspaceDir, 'data', 'cordis.patch.yml')
  if (!fs.existsSync(patchPath)) return []
  try {
    const parsed = loadYamlAny(fs.readFileSync(patchPath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 写入（合并后）home 级补丁：保证 workspace/skills 被 dsh 的 skill-filesystem 扫描。 */
export function writeHomePatch(workspaceDir: string): void {
  const dataDir = path.join(workspaceDir, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const patchPath = path.join(dataDir, 'cordis.patch.yml')
  const merged = mergePatchEntries(readHomePatch(workspaceDir), [], dshSkillPatchEntry(workspaceDir))
  fs.writeFileSync(patchPath, dumpYaml(merged), 'utf8')
}

/** 迁移时合并源补丁：源条目并入（skill-filesystem 保持我们的）。 */
export function mergeSourcePatchIntoHome(workspaceDir: string, sourcePatchPath: string): void {
  const dataDir = path.join(workspaceDir, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const patchPath = path.join(dataDir, 'cordis.patch.yml')
  let incoming: unknown[] = []
  try {
    const parsed = loadYamlAny(fs.readFileSync(sourcePatchPath, 'utf8'))
    if (Array.isArray(parsed)) incoming = parsed
  } catch {
    incoming = []
  }
  const merged = mergePatchEntries(readHomePatch(workspaceDir), incoming, dshSkillPatchEntry(workspaceDir))
  fs.writeFileSync(patchPath, dumpYaml(merged), 'utf8')
}

// ---------------------------------------------------------------------------
// 迁移执行（复制而非移动；冲突策略；进度/取消）
// ---------------------------------------------------------------------------

/** 迁移取消标记（规格 8.4：耗时操作可取消）。 */
let migrationCancelled = false

export function cancelMigration(): void {
  migrationCancelled = true
}

export function resetMigrationCancel(): void {
  migrationCancelled = false
}

export function isMigrationCancelled(): boolean {
  return migrationCancelled
}

export async function runMigration(
  workspaceDir: string,
  sourceHome: string,
  selection: DshDataItemKey[],
  conflictPolicy: MigrateConflictPolicy,
  cbs: MigrateCallbacks
): Promise<MigrateResult> {
  resetMigrationCancel()
  const result: MigrateResult = { ok: false, copied: 0, skipped: 0, renamed: 0, overwritten: 0 }
  const { entries, conflicts } = buildMigrationPlan(sourceHome, workspaceDir, selection)
  if (entries.length === 0) {
    cbs.log('所选数据项没有可复制的文件')
    result.ok = true
    return result
  }
  cbs.log(`迁移计划：${entries.length} 个文件（其中 ${conflicts.length} 个目标已存在，策略：${conflictPolicy === 'overwrite' ? '覆盖' : conflictPolicy === 'skip' ? '跳过' : '重命名'}）`)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const handledPatch = new Set<DshDataItemKey>()
  for (let i = 0; i < entries.length; i++) {
    if (cbs.isCancelled()) {
      result.ok = false
      result.cancelled = true
      cbs.log('迁移已取消')
      return result
    }
    const entry = entries[i]

    // 补丁文件走合并逻辑（保留双方的配置）
    if (entry.key === 'patch' && !handledPatch.has('patch')) {
      handledPatch.add('patch')
      mergeSourcePatchIntoHome(workspaceDir, entry.sourceAbs)
      result.copied += 1
      cbs.log(`已合并用户补丁：${path.basename(entry.sourceAbs)}`)
      cbs.progress(i + 1, entries.length)
      continue
    }

    fs.mkdirSync(path.dirname(entry.destAbs), { recursive: true })
    const destExists = fs.existsSync(entry.destAbs)
    let dest = entry.destAbs
    if (destExists) {
      if (conflictPolicy === 'skip') {
        result.skipped += 1
        cbs.progress(i + 1, entries.length)
        continue
      }
      if (conflictPolicy === 'rename') {
        dest = `${entry.destAbs}.${timestamp}`
        result.renamed += 1
      } else {
        result.overwritten += 1
      }
    } else {
      result.copied += 1
    }
    try {
      fs.copyFileSync(entry.sourceAbs, dest)
    } catch (error) {
      cbs.log(`复制失败：${entry.relPath}（${error instanceof Error ? error.message : String(error)}）`)
      result.ok = false
      result.error = `复制失败：${entry.relPath}`
      return result
    }
    cbs.progress(i + 1, entries.length)
  }

  result.ok = true
  cbs.log(
    `迁移完成：复制 ${result.copied} 个、覆盖 ${result.overwritten} 个、跳过 ${result.skipped} 个、重命名 ${result.renamed} 个（源文件保留在原位置，可手动清理）`
  )
  return result
}
