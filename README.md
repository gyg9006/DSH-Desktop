<div align="center">

# 🚀 DSH 桌面 v2.0

**把 DeepSeek Harness 装进一个文件夹 —— 双击即用 · 拷贝即迁移 · 零安装、零残留**

> DeepSeek Harness（`@deepseek-ai/dsh`）的便携式 Windows 桌面客户端
> React + 赛博朋克 UI · 全中文界面 · 无需一行命令

[![版本](https://img.shields.io/badge/版本-v2.0.0-1E2A78)](https://github.com/gyg9006/DSH-Desktop/releases)
[![平台](https://img.shields.io/badge/平台-Windows%2010%2F11-lightgrey)]()
[![React](https://img.shields.io/badge/React-19-61DAFB)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)]()
[![Electron](https://img.shields.io/badge/Electron-43.4-47848F)]()
[![测试](https://img.shields.io/badge/Tests-189%20passed-brightgreen)]()
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

## 📥 立即下载

**👉 [GitHub Releases 下载 v2.0.0（绿色便携版）](https://github.com/gyg9006/DSH-Desktop/releases)**

- 下载 `DSH-Desktop-v2.0.0-win.zip`，解压后双击「启动 DSH 桌面.bat」即可使用；
- 内置便携 Node / Git / dsh 运行环境，**电脑上什么都不用装**；
- 支持应用内**自动更新**（每 6 小时检测 GitHub Releases 新版本，一键升级）。

</div>

---

## 📸 先看一眼

| 主界面（内嵌 dsh 对话） | 会话管理（便签卡片） |
|:---:|:---:|
| ![主界面](screenshots/v2-main.png) | ![会话管理](screenshots/v2-sessions.png) |
| **Agent 管理（GitHub 导入）** | **知识库（提炼 / 检索 / 迭代）** |
| ![Agent 管理](screenshots/v2-agents.png) | ![知识库](screenshots/v2-knowledge.png) |
| **Skill 管理（插件 / 技能市场）** | **设置（子菜单布局）** |
| ![Skill 管理](screenshots/v2-skills.png) | ![设置](screenshots/v2-settings.png) |
| **高级配置（环境 / API / 备份 / 同步）** | |
| ![高级配置](screenshots/v2-settings-advanced.png) | |

---

## ✨ 为什么值得下载

### 🟢 一个文件夹 = 你的整个工作台
- **绿色免安装**：Node / Git / dsh 全部内置，双击即用，不写注册表、不污染 `%APPDATA%`；
- **拷贝即迁移**：整个文件夹拷到任意 Win10/Win11 电脑继续用 —— 对话、技能、插件、API 配置原样带过去。

### 🛰️ 赛博朋克工作台
- 自定义无边框标题栏、霓虹流光侧边栏、玻璃拟态面板、Canvas 粒子欢迎页；
- 底部状态栏实时显示 dsh 端口 / 本地地址 / 运行状态灯，一键启停服务。

### 💬 开箱即聊
- 内嵌真实 DeepSeek Harness Web 界面直接对话；填入 API Key 自动同步 dsh 配置并热重载。

### 🧩 六大功能模块
1. **核心工作台**：内嵌 dsh 对话 + 会话导入（文件夹/文件）+ 「提炼为知识」一键入库；
2. **会话管理**：便签式分组卡片，会话重命名 / 收藏 / 移动 / 导出 / 删除；
3. **Agent 管理**：GitHub URL 导入 Agent 项目，运行与多 Agent 协同；
4. **知识库**：从会话提炼碎片化知识，自动打时间戳与关键词标签，支持检索与合并去重迭代；
5. **Skill 管理**：插件 / 技能双市场，联网搜索安装，🔥 前 10 推荐，已安装双列管理；
6. **设置**：通用（语言/预设）、外观（主题）、快捷键、关于、高级配置（环境/API/服务/备份/同步）。

### 🛟 数据安全
- 一键备份 / 自动备份（每天每周 + 滚动保留）/ 恢复 / 出厂重置；
- A/B 电脑 Git 异地同步；应用内自动 / 手动更新。

---

## 🧩 功能总览

| 模块 | 能力 |
|---|---|
| **核心工作台** | webview 嵌入 dsh 对话、会话导入（文件夹/文件/压缩包）、知识提炼 |
| **会话管理** | 便签分组卡片、重命名/收藏/移动/导出/删除、返回工作区 |
| **Agent 管理** | GitHub 项目导入、卡片状态、运行日志、多选协同工作 |
| **知识库** | 分类网格、条目 CRUD、关键词/分类检索、启发式提炼、合并去重 |
| **Skill 管理** | 插件市场/技能市场（联网搜索 + 分页 + 推荐标记）、已安装双列管理 |
| **设置** | 通用/外观/快捷键/关于/高级配置（环境检测、API、服务、备份、同步） |
| **环境** | Node / npm / pnpm / Git / dsh 一键检测与安装 |
| **更新** | 自动（每 6 小时）/ 手动检查 GitHub Releases，一键升级 |

**快捷键**：`Ctrl+B` 收起/展开侧边栏 · `Ctrl+N` 新建对话 · `Ctrl+,` 打开设置

---

## 🚀 快速上手

### 方式一：直接下载绿色版（推荐）

```
DSH-Desktop/
├── app/                  ← 程序本体（app\DSH 桌面.exe）
├── workspace/            ← 工作文件夹（运行环境 + 全部数据，随文件夹拷走）
│   ├── runtime/          ← 便携 Node / Git / dsh
│   ├── data/             ← 对话记录、设置、凭据、profiles
│   ├── skills/           ← 技能
│   ├── backups/          ← 备份
│   └── logs/             ← 日志
└── 启动 DSH 桌面.bat     ← 双击启动
```

1. 解压后双击「启动 DSH 桌面.bat」；
2. 底部状态栏点「启动服务」，自动拉起 dsh；
3. 「设置 → 高级配置」填入 DeepSeek API Key → 测试连接；
4. 到「核心工作台」开始对话，聊完点「提炼为知识」沉淀到知识库。

> 💡 换机：整个文件夹拷过去即可，无需重新安装任何东西。

### 方式二：从源码构建

```bash
# 环境要求：Node.js ≥ 18（实测 v24 正常）
npm install
npm run dev          # 开发模式（热更新）
npm test             # 单元测试（189 项）
npm run pack:dir     # 打包为绿色目录（输出到 ../DSH-Desktop/app）
```

---

## 🧭 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 43（无边框窗口）+ electron-vite 5 + electron-builder 26 |
| 前端 | **React 19** + TypeScript 5.9 + Tailwind CSS（赛博朋克主题）+ shadcn 风格组件（Radix primitives） |
| 状态/数据 | hooks + IPC 白名单桥（contextBridge，全类型定义） |
| 测试 | Vitest（189 项，主进程纯逻辑 + 共享层） |
| 运行时 | 便携 Node / Git / dsh（`@deepseek-ai/dsh`） |

```
src/
├── main/       主进程：dsh 服务 / 会话 / 知识库 / Agent / 插件 / 技能市场 /
│               API / 备份 / 同步 / 更新 / 迁移 / 窗口 / 托盘 / IPC
├── preload/    安全白名单 API（contextBridge）
├── renderer/   React 19 界面
│   └── src/
│       ├── components/layout/   TitleBar / Sidebar / Footer
│       ├── components/views/    6 大模块视图 + settings 子页
│       ├── components/ui/       shadcn 风格组件（button/card/dialog/tabs/…）
│       ├── hooks/               useDshService / useTheme
│       └── lib/                 cn 工具 / appInfo
└── shared/     主进程与渲染层共享的类型与纯逻辑
```

---

## ❓ 常见问题

**SmartScreen 提示「已保护你的电脑」？**
未签名应用的正常提示：点「更多信息 → 仍要运行」即可。程序不联网上传任何数据。

**杀毒软件误报？**
便携应用偶发误报，将整个文件夹加入白名单即可。

**端口被占用？**
dsh 默认 3080，应用自动探测并在占用时顺延；也可在「设置 → 高级配置 → 服务与运行」固定端口。

**知识库如何补充？**
在「核心工作台」点「提炼为知识」，粘贴会话内容即可自动提取代码片段与经验段落（生产环境可接入 LLM 提炼技能）。

---

## 🗺️ 里程碑

| 版本 | 内容 |
|---|---|
| v0.1~0.3 | 12 节规格落地：环境检测、会话管理、插件/技能市场、备份同步、自动更新（Vue 版） |
| **v2.0** | **React 19 + 赛博朋克 UI 全面重构**：无边框标题栏、6 入口侧边栏、粒子欢迎页、核心工作台（知识提炼）、会话卡片视图、Agent 管理、知识库、Skill 管理、设置子菜单 |

---

## 📄 许可证

[MIT](./LICENSE) © 2026 DSH 桌面

本应用与 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（MIT）均为开源项目，可自由使用、修改与分发。
