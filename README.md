# DSH 桌面（DSH Desktop）

> **DeepSeek Harness 便携式 Windows 桌面客户端** —— 对话记录、技能、插件与运行环境全部收敛在一个「工作文件夹」内，**拷贝文件夹 = 完整迁移**，绿色免安装、零残留。

![Electron](https://img.shields.io/badge/Electron-43.4-blue)
![Vue](https://img.shields.io/badge/Vue-3.5-42b883)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)
![License](https://img.shields.io/badge/License-MIT-green)
![Tests](https://img.shields.io/badge/Tests-136%20passed-brightgreen)

---

## 📖 简介

DSH 桌面（DSH Desktop）是 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（`@deepseek-ai/dsh`，下文简称 dsh）的官方风格桌面客户端。它把 dsh 的命令行服务、Web 界面与全部数据管理整合成一个**开箱即用的绿色文件夹**：

- 双击即用，无需安装 Node / Git / dsh，无需配置 PATH 与全局环境；
- 所有业务数据、运行环境、配置与日志**全部收敛在文件夹内的 `workspace/`**，不写注册表、不写 `%APPDATA%`；
- 把整个文件夹拷到任意 Win10/Win11 电脑即可继续使用 —— 对话记录、技能、插件、API 配置原样带过去。

它同时是 dsh 的**管理壳**：环境检测与一键安装、服务启停、API Key 管理、插件与技能市场、备份恢复、会话导入/归档/收藏、A/B 电脑异地同步等能力，全部通过图形界面完成，不需要记任何命令。

> 本仓库是**源码工程**（Electron + Vue3）。编译好的绿色交付版（含便携运行时）由 `npm run pack:dir` 从源码构建，详见下文「开发」。

---

## ✨ 软件特点

### 绿色便携（核心卖点）
- 整文件夹拷贝即迁移，**无需安装任何东西**；换机后 dsh 自动重建内部依赖链接（`healProfilesModuleFallback` 自愈机制），数据无损。
- **零系统残留**：Electron userData / sessionData / logs 在 ready 前全部重定向进工作文件夹，实测连续运行（含服务与 webview）后 `%APPDATA%` 与注册表零新增。
- 全中文界面，仿 DeepSeek Harness 设计语言（品牌蓝 + neutral 色板），深色 / 浅色 / 跟随系统。

### 环境一键安装与自检
- 设置页检测 **Node / npm / pnpm / Git / dsh** 五项，缺失项一键下载安装到工作文件夹（便携版，无需命令行、无需管理员权限）。
- 每次启动自动校验数据目录可用性，异常自动重建。

### 服务一键拉起 + 内嵌对话
- 内嵌 dsh Web UI（webview），端口自动探测（被占用自动顺延）、探活指示灯、退出时优雅关闭服务。
- 对话窗口默认隐藏 dsh 内置侧边栏（顶部「☰」随时开关），桌面侧边栏收起时对话窗口同步扩展。
- 系统托盘常驻：最小化到托盘、托盘菜单启停服务 / 恢复窗口 / 退出。

### 数据迁移 / 备份 / 恢复
- **一键迁移**本机存量 dsh 数据（对话 / 技能 / 设置 / 凭据 / profiles），复制而非移动，冲突可覆盖 / 跳过 / 重命名。
- **一键备份**（不含运行环境）、**自动备份**（每天 / 每周 + 保留份数滚动）、导出全部便于换机。

### 会话管理（桌面侧边栏）
- 工作区树 + 分组：工作文件夹收缩展开 / 重命名 / 删除；对话分组可重命名 / 置顶 / 删除。
- 会话支持 **重命名 / 分叉 / 归档 / 移动到分组 / 收藏（★）**。
- 归档按 **年 / 月 / 日** 递归目录存放，打时间与关键词标签，可按时间 / 关键词搜索。
- **导入会话**：支持文件夹 / 单个会话文件多选两种模式，独立导出的 session 文件也能直接导入；**.zip / .tar 等压缩包导入时自动解压**（含会话目录与散放的会话文件）。
- **异地同步**：A/B 两台电脑之间基于 Git 同步会话，A 电脑「上传到服务器」、B 电脑「下载到本地」无缝切换。
- 视图选项：分组方式（工作区 / 分组 / 无）与排序方式（最近更新 / 创建时间），对桌面侧边栏与 dsh 界面**同时生效**。

### 模型与 API 同步 dsh
- API Key 与自定义提供方保存后**自动写入 dsh 的 `settings.yaml` / `.credentials.yaml`**（热重载），对话界面与 Models 页直接生效，无需重复输入。
- 提供方管理与 dsh「模型」设置页**双向同步**，支持 DeepSeek / Pi-AI 等自定义 Base URL、模型发现与测试连接。

### 插件与技能市场
- **功能插件**：内置一批随 dsh 自带的离线功能插件，一键启用 / 停用。
- **在线插件市场**：按中文功能词 / 插件名搜索 npm（npmmirror 镜像），一键 pnpm 安装与卸载。
- **推荐技能**：50 个社区推崇的开源技能（含 anthropics/skills 与 obra/superpowers 等，绿色「推荐」标签），每页 10 个分页展示；经 npmmirror 技能合集**按名直装单个技能**（无需 GitHub），装进 `workspace/skills` 即可在对话中使用。

### 通用设置同步 dsh
- 语言 / dsh 界面外观 / Agent 预设（标准 · 极简 · PTC · 创造）保存后写入 dsh 的 `settings.yaml`（热重载），与 dsh 网页端共用。

### 其他
- 快捷键：`Ctrl+B` 收起/展开任务栏 · `Ctrl+N` 新建对话 · `Ctrl+,` 打开设置。
- 出厂重置（初始化）：把应用交给别人前一键恢复干净状态（清空对话 / 凭据 / 路径，可选保留运行环境）。

---

## 📸 界面预览

*（占位：构建并运行后，可在 `screenshots/` 目录放置主界面 / 设置页截图，并在下方引用）*

```
[screenshot-main.png] 主界面（侧边栏 + 内嵌对话）
[screenshot-settings.png] 设置（通用设置 / 环境检测 / 工作文件夹 / 服务与运行 / 模型与API / 插件 / 备份与恢复 / 异地同步 / 日志与关于）
```

---

## 🚀 使用方式（最终用户）

### 方式一：使用编译好的绿色交付版（推荐）
构建产物是**整个文件夹**，结构与用法如下：

```
DSH-Desktop/
├── app/                  ← 程序本体（app\DSH 桌面.exe）
├── workspace/            ← 工作文件夹（环境 + 全部数据，随文件夹一起拷走）
│   ├── runtime/          ← 便携 Node / Git / dsh（装好的运行环境）
│   ├── data/             ← 对话记录、设置、凭据、profiles
│   ├── skills/           ← 你的技能
│   ├── plugins/          ← 插件
│   ├── config/           ← 应用与 API 配置
│   ├── backups/          ← 备份
│   └── logs/             ← 日志
├── DSH 桌面.lnk          ← 快捷方式
└── 启动 DSH 桌面.bat     ← 双击启动（推荐）
```

**步骤：**

1. 把整个 `DSH-Desktop/` 文件夹拷贝到目标电脑（U 盘 / 网盘 / 局域网均可）。
2. 双击 `启动 DSH 桌面.bat`（或 `app\DSH 桌面.exe`）。
3. 首次启动进入三步向导：确认工作文件夹 → 环境检测（已随文件夹迁移，无需安装）→ 完成。
4. 在「设置 → 模型与 API」填入 API Key（已随文件夹迁移则无需重填）→ 保存 → 测试连接。
5. 点击「开始对话」（或侧栏「启动」）拉起服务，开始对话 —— 对话记录自动保存在工作文件夹内。

> 换机提示：若目标机器未装 Node/Git，先到「设置 → 环境检测」一键安装缺失项即可，数据无损。

### 方式二：从源码自行构建

```bash
# 环境要求：Node.js ≥ 18（实测 v24 正常）、Git、pnpm（可选）
npm install            # 安装依赖
npm run dev            # 开发模式（热更新）
npm test               # 单元测试（136 项）
npm run pack:dir       # 打包为免安装目录（输出到 ../DSH-Desktop/app）
```

打包后按「方式一」的目录结构使用。

---

## 🧭 技术栈与架构

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 43 + electron-vite 5 + electron-builder 26（dir 目标） |
| 前端 | Vue 3.5 + Pinia + Element Plus 2.14 + Tailwind CSS 3.4（class 暗色模式） |
| 语言 | TypeScript 5.9（主进程 / preload / 渲染层全类型） |
| 测试 | Vitest 4（主进程纯逻辑 + 共享层，136 项） |
| 运行时 | 便携 Node / Git / dsh（`@deepseek-ai/dsh`） |

```
src/
├── main/       主进程：config / logger / envCheck / installer / migrate / dshService /
│               sessions / sessionOps / workspaces / apiConfig / plugins / skillsMarket /
│               backup / logs / tray / ipc / window / index
├── preload/    安全白名单 API（contextBridge）
├── renderer/   Vue3 + Pinia + Element Plus + Tailwind（布局 / 设置 9 Tab / 向导 / 会话树）
└── shared/     主进程与渲染层共享的纯逻辑与类型（可单测）
```

### 关键技术决策（已联网核实）
- **dsh 数据目录**：`@deepseek-ai/dsh`（0.1.0-rc.6）官方支持 `$DSH_HOME` 环境变量（默认 `~/.dsh`），全部用户数据收敛于单一根目录。本应用启动 dsh 时注入 `DSH_HOME=<工作文件夹>/data`、cwd=工作文件夹（dsh 以 cwd 为 workspace 根），并注入 `DSH_TELEMETRY_DISABLED=1` 关闭遥测 —— 无需目录联结（Junction），拷贝即迁移。
- **dsh 启动**：`dsh web`（= `--profile web`），默认端口 3080，支持 `--port`；web 应用参数（`--host/--port/--trusted-host`）已核实。
- **API 注入**：dsh 的 LLM 适配器读取 `DEEPSEEK_API_KEY` 与 `DEEPSEEK_BASE_URL` 环境变量（endpoint = baseURL + `/chat/completions`），已在服务启动时注入。
- **技能接入**：用户技能根为 `$DSH_HOME/skills`（dsh-skill-filesystem 的 user-dsh 根）；应用通过 `$DSH_HOME/cordis.patch.yml` 的 `skill-filesystem.customSkillDirs` 把 `workspace/skills` 接入（`dsh web --dump-config` 实测生效）。
- **会话存储**：dsh 布局 `data/sessions/<cwd-sanitized>/<session-id>/session.jsonl[.zstd]`；工作区注册表 `data/storages/workspace.json`；标题缓存 `session_projcache.json`。
- **零残留**：Electron userData/sessionData/logs 在 ready 前重定向进工作文件夹；实测 `%APPDATA%` 与注册表零新增。
- **窗口**：默认 1280×800、最小 1000×640，窗口状态记忆在工作文件夹。

---

## 📁 源码目录结构

| 路径 | 说明 |
|---|---|
| `src/main/` | Electron 主进程（配置 / 环境检测 / 安装器 / 迁移 / dsh 服务 / 会话 / 工作区 / API / 插件 / 技能市场 / 备份 / 托盘 / IPC） |
| `src/preload/` | 渲染进程安全桥（contextBridge 白名单 API） |
| `src/renderer/` | Vue 3 界面（侧边栏 / 对话 webview / 设置 9 Tab / 三步向导） |
| `src/shared/` | 主进程与渲染层共享类型与纯逻辑 |
| `scripts/` | 构建辅助（图标生成 / 打包平铺）与 CDP 验证脚本 |
| `resources/` | 应用资源（图标等） |
| `build/` | 打包资源（icon.ico 等） |

---

## ❓ 常见问题

### SmartScreen 提示「已保护你的电脑」
首次运行未签名 exe 时 Windows SmartScreen 可能拦截。点击「更多信息 → 仍要运行」即可（无签名本地应用的正常提示，程序不联网上传任何数据）。

### 杀毒软件误报
便携式应用偶发误报，可将整个文件夹加入白名单；如需彻底消除可自行用代码签名证书对 exe 签名。

### 端口被占用
dsh 默认端口 3080；应用启动前自动探测，被占用自动顺延到下一个可用端口（记录在配置中）。可在「设置 → 服务与运行」手动固定端口。

### 换机后 dsh 提示异常
dsh 会在 `$DSH_HOME/profiles/node_modules` 建立内部依赖链接（机器相关），换机后首次启动自动重建（自愈机制）。若仍未生效，删除该目录后重启服务即可。

### API Key 在哪配置
「设置 → 模型与 API」→ 填入 DeepSeek API Key（密码框可显示/隐藏）→ 保存 → 「测试连接」验证。Key 保存于工作文件夹 `data/.credentials.yaml`，启动服务时以环境变量注入 dsh。

### 备份恢复后需要做什么
备份不含运行环境（体积大且机器相关）；换机恢复后在新机器重新执行一次「环境检测 → 一键安装缺失项」即可，数据无损。

---

## 🗺️ 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 脚手架 + 主界面布局（分栏/收起/设置空壳/主题） | ✅ |
| M2 | 环境检测 + 便携 Node/Git/pnpm/dsh 一键安装与更新（实时日志） | ✅ |
| M3 | 工作文件夹 + 一键迁移 + 数据目录策略 + 首次启动向导 | ✅ |
| M4 | dsh 服务生命周期 + webview 内嵌对话 + 会话列表 | ✅ |
| M5 | 设置 Tab3~6 + 托盘/快捷键 | ✅ |
| M6 | 打包 + 便携性验证（拷贝实测：向导/服务/真实对话/零残留） | ✅ |
| M7 | 错误处理加固、空态/异常态补全、README 完整版 | ✅ |
| R2~R8 | 迭代增强：会话管理（重命名/分叉/归档/收藏/分组）、工作区操作、导入会话（含压缩包自动解压）、异地同步（Git）、插件市场、推荐技能市场、API 双向同步、视图分组排序、中文路径加固 | ✅ |

---

## 📄 许可证

[MIT](./LICENSE) © 2026 DSH 桌面

本应用与 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（MIT）均为开源项目。
