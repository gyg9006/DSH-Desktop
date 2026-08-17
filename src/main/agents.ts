/**
 * v2.0 Agent 管理模块：Agent 项目（GitHub 仓库）导入 / 列表 / 运行骨架。
 * - 导入：解析 GitHub URL → 拉取仓库元数据（api.github.com，公共仓库无需 token）。
 * - 运行 / 协同：骨架实现，返回模拟日志流；生产环境 TODO 接 dsh 的 agent 会话编排。
 * 数据存 <workspace>/data/agents.json。
 */
import path from 'node:path'
import crypto from 'node:crypto'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { logger } from './logger'
import type {
  AgentCollaborateInput,
  AgentCollaborateResult,
  AgentImportResult,
  AgentInfo,
  AgentRunResult,
  AgentsPayload
} from '../shared/ipc'

interface AgentStore {
  version: number
  agents: AgentInfo[]
}

function dataFile(workspaceDir: string): string {
  return path.join(workspaceDir, 'data', 'agents.json')
}

function readStore(workspaceDir: string): AgentStore {
  const raw = readJsonFile(dataFile(workspaceDir))
  if (!raw || typeof raw !== 'object') return { version: 1, agents: [] }
  const s = raw as Partial<AgentStore>
  return { version: 1, agents: Array.isArray(s.agents) ? (s.agents as AgentInfo[]) : [] }
}

function writeStore(workspaceDir: string, store: AgentStore): void {
  try {
    writeJsonAtomic(dataFile(workspaceDir), store)
  } catch (error) {
    logger.error(`Agent 数据保存失败：${String(error)}`)
    throw error
  }
}

function uid(): string {
  return crypto.randomUUID()
}

export function listAgents(workspaceDir: string): AgentsPayload {
  return { agents: readStore(workspaceDir).agents }
}

/** 解析 GitHub URL → { owner, repo }，非法 URL 返回 null。 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim()
  const m = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/)
  if (!m) return null
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') }
}

/** 从 api.github.com 拉取仓库元数据（公共仓库无需鉴权）。 */
async function fetchRepoMeta(owner: string, repo: string): Promise<{ description: string; fullName: string } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return null
    const body = (await res.json()) as { description?: unknown; full_name?: unknown }
    return {
      description: typeof body.description === 'string' ? body.description : '',
      fullName: typeof body.full_name === 'string' ? body.full_name : `${owner}/${repo}`
    }
  } catch (error) {
    logger.warn(`GitHub 仓库元数据获取失败：${String(error)}`)
    return null
  }
}

export async function importAgent(workspaceDir: string, url: string): Promise<AgentImportResult> {
  const parsed = parseGitHubUrl(url)
  if (!parsed) return { ok: false, error: '无效的 GitHub 仓库地址（示例：https://github.com/anthropics/superpowers）' }
  const store = readStore(workspaceDir)
  const fullName = `${parsed.owner}/${parsed.repo}`
  if (store.agents.some((a) => a.repoUrl.includes(fullName))) {
    return { ok: false, error: `Agent 已存在：${fullName}` }
  }
  const meta = await fetchRepoMeta(parsed.owner, parsed.repo)
  const name = parsed.repo
  const agent: AgentInfo = {
    id: uid(),
    name,
    repoUrl: `https://github.com/${fullName}`,
    description: meta?.description ?? '（未获取到仓库描述）',
    status: 'idle',
    createdAt: Date.now()
  }
  store.agents.push(agent)
  writeStore(workspaceDir, store)
  return { ok: true, agent }
}

export function renameAgent(workspaceDir: string, id: string, name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('名称不能为空')
  const store = readStore(workspaceDir)
  const agent = store.agents.find((a) => a.id === id)
  if (!agent) throw new Error('Agent 不存在')
  agent.name = trimmed
  writeStore(workspaceDir, store)
  return true
}

export function deleteAgent(workspaceDir: string, id: string): boolean {
  const store = readStore(workspaceDir)
  store.agents = store.agents.filter((a) => a.id !== id)
  writeStore(workspaceDir, store)
  return true
}

/**
 * 运行单个 Agent（骨架）：真实实现 TODO 接入 dsh agent 会话
 * （在 dsh 中启动该 Agent 预设项目的工作会话并转发日志流）。
 */
export async function runAgent(workspaceDir: string, id: string): Promise<AgentRunResult> {
  const store = readStore(workspaceDir)
  const agent = store.agents.find((a) => a.id === id)
  if (!agent) return { ok: false, error: 'Agent 不存在' }
  agent.status = 'running'
  writeStore(workspaceDir, store)
  // TODO: Install specific skill for production —— 接入 dsh agent 会话编排
  await new Promise((r) => setTimeout(r, 300))
  agent.status = 'idle'
  writeStore(workspaceDir, store)
  return {
    ok: true,
    log: `[${new Date().toLocaleTimeString()}] 启动 Agent「${agent.name}」（${agent.repoUrl}）\n[骨架] 会话编排尚未接入 dsh，真实运行将在此展示日志流。`
  }
}

/** 多 Agent 协同（骨架）：并行启动并聚合日志。TODO 接 dsh 多会话编排。 */
export async function collaborateAgents(workspaceDir: string, input: AgentCollaborateInput): Promise<AgentCollaborateResult> {
  const store = readStore(workspaceDir)
  const agents = store.agents.filter((a) => input.agentIds.includes(a.id))
  if (agents.length === 0) return { ok: false, log: '', error: '未选择 Agent' }
  if (!input.task.trim()) return { ok: false, log: '', error: '请填写协同任务描述' }
  // TODO: Install specific skill for production —— 多 Agent 并行编排（dsh 多会话）
  const lines = agents.map((a, i) => {
    const t = new Date().toLocaleTimeString()
    return `[${t}] Agent#${i + 1}「${a.name}」已就绪，分配任务片段…（骨架）`
  })
  return {
    ok: true,
    log: [`[${new Date().toLocaleTimeString()}] 协同任务：「${input.task}」`, ...lines].join('\n')
  }
}
