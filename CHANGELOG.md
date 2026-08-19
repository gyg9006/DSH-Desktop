# 更新日志（CHANGELOG）

本项目的所有显著变更都会记录在此文件中。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.1.9] - 2026-08-19

### 新增

- **设置 → 通用 → 「重新体验引导」**：一键重置引导状态并重启，重新进入三步引导（工作文件夹 / 环境检测 / API Key），已保存配置与数据不受影响；
- **dsh 对话页模型选择器始终可用**：`syncModelsConfigToDsh` 在用户未配置任何厂商时默认写入 `llm-deepseek` 预设模型（deepseek-chat / deepseek-reasoner），无需先填 Key 即可看到并选择模型；
- **dsh 不再弹 API Key 输入引导**：dsh 界面加载后注入脚本隐藏 onboarding / API Key 引导类弹窗（Key 统一在客户端「设置 → 模型与 API」配置），主路径是 settings.yaml 已写入模型预设使 dsh 不进入「未配置」引导态。

### 使用

- 首次打开（onboarded 未完成）显示三步引导；已完成的用户可在「设置 → 通用 → 重新体验引导」再次进入；
- 所有厂商 API Key 均在「设置 → 模型与 API」配置，保存即同步 dsh（模型选择器立即可选、不再弹 Key 引导）。

## [2.1.8] - 2026-08-19

### 修复

- **客户端启动/点启动服务时偶发直接退出**：根因是**单实例锁残留**（异常退出/强杀后 Electron `SingletonLock` 未清理 → 下次启动拿锁失败即 quit）。新增 `acquireSingleInstanceLock`：锁失败时先检查是否真有其他实例，无则清理锁残留后重试一次；
- **端口冲突不顺延 / 服务与运行功能不生效**（v2.1.7 发布版）：端口模式保存的闭包 bug（点「自动探测」实际保存了 fixed）已在本版随 v2.1.7 修复，本版一并发布；`probeFreePort` 顺延逻辑确认正常（fixed 端口被占自动顺延到下一空闲端口）；
- 新增「使用系统 dsh（正常版）」开关（设置 → 服务与运行）：跳过内置便携 dsh，改用系统 dsh（npm 全局/npx 缓存）配合系统 Node 启动；
- 退出路径日志（window-all-closed / before-quit / 窗口 close）便于后续排查。

### 实测

- 单实例锁：强杀后再次启动可正常进入（锁残留自动清理）；
- 端口：3080 被占 → 配置 fixed 3081 服务正常起于 3081；固定端口被占自动顺延；
- 内置 dsh 自动修复：历史 junction 坏安装 → 自动清理重装 551 依赖 → `dsh web 就绪`；
- 系统 dsh：`node <npx缓存>\@deepseek-ai\dsh\lib\bin.js web --port 3081` → 服务就绪。

## [2.1.7] - 2026-08-19

### 修复

- **服务与运行：自动探测 / 固定端口保存后不生效**：根因是点击时 `setPortMode`（异步）+ `savePort()` 闭包读到**点击前的旧值**（点「自动探测」实际保存了 fixed，反之亦然）。改为保存时显式传模式与端口，立即生效；
- **新增「使用系统 dsh（正常版）」开关**（设置 → 服务与运行）：开启后跳过内置便携 dsh，改用系统 dsh（npm 全局安装或 npx 缓存 `@deepseek-ai/dsh`）配合系统 Node 启动服务；`resolveSystemDshBin` 自动解析 npm 全局根与 npx 缓存（cmd 包装解决 Windows 下 `.cmd` 无法直接 spawn 的问题）。

### 实测

- 端口模式保存：固定端口 39999 → 保存生效；自动探测 → 保存生效；
- 系统 dsh 启动：`node <npx缓存>\@deepseek-ai\dsh\lib\bin.js web --port 3081` → `dsh web 就绪`，服务运行正常；
- 内置便携 dsh 启动路径保持默认（不开启开关时）。

## [2.1.6] - 2026-08-19

### 修复

- **点击「启动服务」应用异常/服务无法启动**（EPERM：Permission denied）：根因是**中断的 npm install 残留进程**持有 `runtime/dsh` 目录句柄 → 自动修复（清理坏安装重装）删除目录时 EPERM 失败。修复：
  1. `cleanupRuntimeNode`：启动服务自动修复前，先清理本工作区 runtime 下残留的 node/npm 进程（中断的安装任务）；
  2. 修复 PowerShell `-like` 匹配（反斜杠为字面，之前 `\\` 转义导致永不匹配——`cleanupStaleDsh` 同修）；
  3. `safeRemoveDir` 删除失败自动重试（600ms × 3），等待残留进程释放句柄；
- 实测：残留进程场景 → 自动清理 → 坏安装删除成功 → 重装 275 依赖 → 服务运行（端口 3081），应用全程稳定不退出。

### 说明

- 首次打开不显示引导页：工作文件夹 `config/app.json` 的 `onboarded=true`（此前已完成/跳过引导）即直接进主界面；如需全新引导，更换工作文件夹即可。

## [2.1.5] - 2026-08-18

### 修复

- **设置里输入 API Key 后无法同步到 dsh**（模型选择器消失 / dsh 反复提示输入 API Key）：根因是保存 Key 只写加密存储（secure-keys.json），不创建 models.json → `llm-deepseek`/`llm-pi-ai` 段不写 → dsh 模型选择器无数据、凭据不同步。**保存 Key 时自动启用该厂商并补齐默认模型**，一次保存即同步 models.json → settings.yaml → credentials.yaml，dsh 对话页模型选择器立即可选、不再提示配置 Key；
- **dsh 服务启动失败（历史 symlink 安装）**：v2.1.3 的 `npm install <dir> --prefix` 是 file:link 语义 → `runtime/dsh` 是指向内置的 junction 且不装依赖 → 启动即 `ERR_MODULE_NOT_FOUND`。新增 `dshInstallBroken` 检测 + `safeRemoveDir`（junction 用 rmdir 删链接本身，防止误删内置环境），启动服务自动清理重装；
- **服务端口配置 hover Tooltip**：自动探测/固定端口补悬停提示（300ms 显示/200ms 消失）。

### 版本更新保护机制（防再犯）

- `resources/feature-registry.json`：功能注册表（10 个功能模块 + required 标记 + 关键产物清单）；
- `smokeTestApp`：更新包安装前冒烟（exe 名 / 内置环境 / asar），任一失败中止更新，旧版本不受影响；
- `update.bat` 增强：替换后二次校验，失败回滚到 app.old；
- 更新报告 `logs/update-report.md`（版本/冒烟/回滚留档）；
- `verify-build.mjs` 集成 feature-registry 校验。

## [2.1.4] - 2026-08-18

### 修复

- **「跳过引导」后一键启动服务失败**（闭环修复）：`env-resolver` 的 dsh 内置解析漏拼 `dir` 前缀（返回 `lib/bin.js` 而非 `dsh-cli/lib/bin.js`）→ 内置 dsh 永远识别不到，点「启动服务」误报「未安装 dsh」。已修复并补单测；
- **启动服务自动启用内置环境**：`startDshService` 检测到内置 dsh 未安装时自动启用（内置 node + dsh 复制 + 依赖安装，免手动一键安装），服务可直接启动；
- **内置 dsh 依赖安装**：`installDsh` 目录形态由 `npm install <目录> --prefix`（file:link 语义不装依赖）改为复制到工作区后在包内 `npm install`（551 依赖完整解析），并新增端到端单测（真实内置包 + 干净工作区，dsh --version 可运行）；
- **新增设置 → 高级 → 日志卡片**：查看应用/dsh 服务日志、一键导出 zip（排查问题时附上）、清空日志。

## [2.1.3] - 2026-08-18

### 新增

- **首次引导可跳过**：三步引导（工作文件夹/环境检测/API Key）每步底部新增「跳过引导」按钮（确认后直接进入主界面，环境与 Key 可稍后在「设置」中配置，不自动启动 dsh 服务）。

### 修复

- **Win10 LTSC 21H2 等精简系统无法运行服务**：根因为系统缺少 VC++ 运行库（vcruntime140.dll / vcruntime140_1.dll / msvcp140.dll），内置 node.exe 启动失败导致 dsh 服务起不来。`prepare:env` 现随包分发 3 个 VC 运行库 DLL 到 `portable-env/node/`（与 node.exe 同目录自包含，免系统安装）；`verify-build` 增加 DLL 存在性校验；环境检测在 node 执行失败时提示「可能缺少 VC++ 运行库」。

## [2.1.2] - 2026-08-18

### 修复（打包缺陷紧急修复）

- **便携环境真正内置**：`prepare:env` 由「原始归档」改为「解压目录」形态（`resources/portable-env/node|git|pnpm|dsh-cli/`），随包分发、免下载可直接执行；新增 `env-resolver` 三级优先级（内置 → 工作区 → 系统），环境检测显示 [内置]/[工作区]/[系统] 来源标签；缺失项一键安装自动启用内置环境（[启用内置环境] 按钮），npm/pnpm/dsh 安装前自动确保便携 Node，不再误报「未找到便携 node」；dsh 服务启动同样按三级解析 Node；
- **EXE 文件名乱码**：`productName`/`win.executableName` 由中文改为纯 ASCII `DSH-Desktop`（实测原 "DSH 桌面.exe" 在发布包中损坏为 "DSH ??.exe"）；窗口标题/托盘提示/错误框/HTML title 同步 ASCII 化；新增 `artifactName: DSH-Desktop-Setup-{version}.{ext}`；
- **构建后自动校验**：新增 `scripts/verify-build.mjs`——exe 文件名正则 + `resources/portable-env` 完整性（node/git/pnpm/dsh 可执行校验）+ env-manifest 平台匹配，任一失败构建即失败；`pack:dir` 与 Actions 发布流水线均接入，校验日志留档 `verify-build.log`；
- **pnpm 下载多源**：GitHub 直连（多 IP 轮换）失败自动切换加速镜像（gh.ddlc.top / gh-proxy.com）。

### 质量

- 新增 `env-resolver` 单测 8 项（三级优先级/平台匹配/内置可用性）；installer/installNode 端到端用真实内置包验证（免下载复制安装）；全量回归 244 通过（3 项 smartSync 集成用例依赖 CI 系统 Git 环境，见 Actions 全绿）。

## [2.1.1] - 2026-08-18

### 修复

- **更新流程：10 分钟冷却期内点击「立即更新」失败**（冷却缓存结果不含 assetId/直链，误报"已是最新版本"且不下载）→ 手动检查与「立即更新」改为 `force` 检查（绕过冷却，始终拿到完整下载参数）；
- **关于页文案双 v**："发现新版本 vv2.1.1" → "发现新版本 v2.1.1"（`latest` 已含 v 前缀）。

### 质量

- 端到端更新验证（本地 mock 更新源 + 真实 228MB 更新包）：检查 → 通知 → 立即更新 → 4 线程下载 → SHA256 校验（与发布 SHA256SUMS 逐字节一致）→ "更新包已下载"，全程渲染层零异常；
- 新增测试工具脚本：`scripts/mock-update-server.mjs`（模拟 GitHub Releases + Range 文件服务）、`scripts/cdp-update-e2e-check.mjs`（CDP 端到端更新验证）。

## [2.1.0] - 2026-08-18

### 新增（体验优化专项，6 项）

1. **首次启动三步引导 + 白屏修复**：独立渲染的引导向导（工作文件夹 → 环境检测/一键安装 → API Key 配置并测试），入口守卫（`onboarded` 强制跳转）、`#/onboarding` 直达；移除 dsh onboarding JS 注入 hack；渲染层 ErrorBoundary + 主进程加载失败/崩溃兜底；
2. **上传下载智能同步（Git 时间戳比对）**：`smartSync` 引擎——本地 mtime vs 远端提交时间（批量 `git log --format=%ct --name-only`），容差窗口内容比对判冲突；预览面板（上传/下载/跳过/冲突 + 勾选 + 统计）、冲突三选一（保留本地/使用远程）、模式（智能/仅新增/强制）、时间容差、.gitignore 排除规则、自动同步调度（`sync-completed` 事件）；
3. **环境一键安装 + 打包内置便携环境**：环境卡片缺失项新增 [一键安装]；`scripts/prepare-portable-env.mjs` 下载 Node/MinGit/pnpm/dsh 归档 + `env-manifest.json`（版本锁定 + sha256）；electron-builder `extraResources` 内置（asar 外），installer 内置优先（免下载 + 校验），未内置回退官方源 + npmmirror 镜像；
4. **版本更新提示与下载加速**：右下角非阻断通知（[立即更新][稍后提醒][查看日志]）+ 更新进度窗口 + 手动检查按钮；`FastDownloader`——4 线程 Range 分片、断点续传（.parts）、镜像测速选源、SHA256 校验（发布侧随包上传 SHA256SUMS）、校验失败自动换源；自动模式改为「自动检查 + 通知」，同版本/稍后提醒不重复打扰；
5. **工作文件夹设置与数据迁移**：设置 → 通用新增工作文件夹卡片（当前路径 + 更改位置并迁移 + 打开目录）；`workspaceRelocate` 原子迁移——流式复制（排除 runtime/tmp/sync）→ 完整性校验 → 配置切换 + 默认指针 → 旧目录 `.old` 全量备份 → 失败回滚；
6. **会话背景自定义**：设置 → 外观新增会话背景（跟随主题/纯色选择器/8 组渐变预设/上传图片，Canvas 压缩 ≤2K + SVG 原样）；填充（cover/contain/fill）、透明度、模糊调整；仅作用于核心工作台对话区域（不影响侧边栏/标题栏）；图片存 `workspace/data/session-bg/`。

### 修复

- `runCommand` Windows 下无法解析 `.cmd` 垫片（npm/pnpm 被误判未安装）→ 新增 `resolveWindowsCommand` 按 PATH 解析真实路径；
- 首次同步（全新本地仓库）`pull --rebase` 整树根提交 replay 导致 add/add 冲突卡死 → `reset --soft origin/<branch>` 以远端为基 + 残留 rebase 清理；
- FastDownloader 分片合并偏移错位（`writeSync(position)` 不推进文件位置）→ 手动累计偏移；
- 工作目录迁移在部分环境目录 rename EPERM → 改为「复制 + 删除」原子切换。

### 质量

- 单元测试 **240 项**全部通过（新增 onboarding / smartSync / fastDownloader / workspaceRelocate / installer 内置环境 35 项）；typecheck + electron-vite 构建全绿；CDP 运行时自测（引导/智能同步全链路/内置环境安装/会话背景/更新 UI）；
- 新增 6 个可复用 Skill 封装（SKILL.md），随专项文档发布至 `gyg9006/DSH_HH`。

## [2.0.0] - 2026-08-17

### 重构

- **渲染层整体迁移 Vue → React 19**：TypeScript + Tailwind CSS + shadcn 风格组件（Radix primitives：button / card / input / dialog / tabs / switch / badge / pagination 等），全类型 IPC 桥保持不变。
- **赛博朋克 / 科技感深色 UI**：自定义无边框标题栏（frame:false + 窗口控制 IPC）、6 入口侧边栏（霓虹流光选中态）、底部状态栏（端口 / 本地地址 / 状态灯 + 服务启停）、Canvas 粒子欢迎页、玻璃拟态面板、数据流动画与扫描线。

### 新增（6 大功能模块）

1. **核心工作台**：webview 嵌入完整 DSH Web 界面；会话导入（文件夹 / 文件）；「提炼为知识」对话框（启发式提取 → 知识库，无分类引导新建）。
2. **会话管理**：便签式分组卡片网格（[+新增分组] 虚线卡 + 分组重命名/删除/置顶）；分组详情会话列表（重命名 / 收藏 / 移动到组 / 返回工作区 / 导出 / 删除）。
3. **Agent 管理**：GitHub URL 导入（自动拉取仓库信息）；卡片状态徽章；运行（日志弹窗）；多选「协同工作」（并行日志流骨架）。
4. **知识库**：分类网格（条目计数 + 数据流动画）；知识条目 CRUD（自动时间戳 + 关键词标签）；关键词 / 分类检索；合并去重迭代；SkillAdapter 接口（启发式 Mock，生产可接 LLM）。
5. **Skill 管理**：Tabs [插件市场] [技能市场] [已安装]；联网搜索（按名字/功能词）；🔥 前 10 推荐标记；每页 10 项分页器；已安装插件 / 技能双列管理。
6. **设置**：左侧子菜单 + 右侧表单——通用（语言 / Agent 预设）、外观（主题深/浅/跟随系统）、快捷键、关于（版本 + 更新）、高级配置（环境检测 / 模型与 API / 服务与运行 / 自动备份 / 异地同步）。

### 修复

- Electron 不支持 `window.prompt()`：知识库分类创建/重命名、Agent 重命名改为 Dialog 输入框。
- 打包平铺脚本支持全新 app 目录（仅含 win-unpacked / builder 辅助文件）。

### 质量

- 主进程新增 `knowledge.ts` / `agents.ts` 模块与 13 个新 IPC 通道（含 12 项新单元测试）。
- 单元测试 **189 项**全部通过；typecheck（node + web）全绿；electron-vite 构建 + electron-builder 打包验证通过；打包产物 CDP 实测（布局 / 服务 / webview / 各模块）。

## [0.3.0] - 2026-08-16

### 新增

- **插件设置重构**（设置 → 插件）：
  - 「功能插件」页内置推荐插件列表之上新增**联网搜索**（按名字 / 功能词，如「搜索」「数据库」「mcp」），npmmirror 精确 / 全文检索，结果可直接安装（pnpm add 到 profile）。
  - 移除与搜索功能重复的「在线插件市场」tab（两处能力合并进「功能插件」页）。
  - 「推荐技能」页新增**联网搜索**（按名字 / 功能词，如「pdf」「代码审查」），可安装任意 npm 技能包（包内所有含 SKILL.md 的技能装进 workspace/skills）；新 IPC `skills:search` / `skills:install-npm`。
  - 「已安装」页同时展示**已安装插件列表**与**已安装技能列表**（workspace/skills），一目了然。
- **设置拆分**：原「日志与关于」拆为两个独立 tab——
  - 「日志与初始化」：应用日志 / dsh 运行日志（过滤 / 刷新 / 导出 zip / 清空）+ 出厂重置（保留运行环境或完全重置），去掉关于内容与顶部版本显示。
  - 「关于」：醒目版本卡片（客户端版本 + dsh / Node / Git / Electron / Chromium 版本号）+ 更新方式（自动 / 手动、检查更新、下载、重启应用），去掉日志与重置。
  - 侧边栏设置项与导航同步更新为「日志与初始化」「关于」两项。

### 修复

- 技能联网搜索 `searchNpmSkills` 参数传递错误（把工作目录误作搜索词），已修正为按用户输入搜索。

### 测试

- 单测保持 **181** 项全部通过；typecheck（tsc + vue-tsc）全绿；内置应用 CDP 实测：插件三子页、联网搜索（含中文功能词「代码审查」28 条结果）、已安装双列表、日志与初始化 / 关于两页均符合预期。

## [0.2.0] - 2026-08-16

### 新增

- **版本更新功能**（设置 → 日志与关于）：支持自动 / 手动两种更新模式。
  - 自动更新：应用启动 10 秒后与每 6 小时自动检测新版本（GitHub Releases），发现新版本自动下载，完成后提示重启应用完成更新。
  - 手动更新：点击「检查更新」按钮检测，可查看更新内容，手动下载并应用。
  - 更新包走 GitHub Releases 资产，网络层绕过被 DNS 污染的 github.com 主站（经 api.github.com → objects CDN）。
- **skill 支持新增**：`simplify`（code-simplifier）技能随技能市场可用（与 code-review 一并用于本次全量代码审查）。
- 安装 `code-review` 与 `simplify` 两个技能用于项目自审（真实 dsh 会话扫描全部源码，产出 P0/P1/P2 分级报告）。

### 修复

- **关闭窗口行为修复**：此前「关闭即隐藏到托盘」的拦截注册在窗口创建之前，从未生效——点击 X 会直接销毁窗口且托盘无法恢复。现改为窗口创建后注册拦截；托盘在窗口被销毁时也能自动重建主窗口。
- **服务启动超时单位不一致**：设置页「启动超时时间」以秒存储（默认 60），主进程却按毫秒使用，保存一次服务配置后启动即超时。现统一按秒换算为毫秒。
- **删除工作区（服务不可达回退）算错会话目录名**：改用 `dshProjectKey` 规则定位并删除会话目录，同时清理该工作区会话的归档 / 分组映射 / 收藏索引，避免孤儿数据与残留引用。
- **归档会话查找只认 zstd**：`compression: none` 的未压缩归档会话无法还原 / 删除，现兼容明文与压缩两种格式。
- **技能 tar 解包路径穿越**：npm 技能包条目路径经规范化校验，拒绝 `../` 与绝对路径，恶意包无法写出技能根目录。
- **YAML 全文往返破坏 dsh 配置**：`settings.yaml` / `.credentials.yaml` / `cordis.patch.yml` 的读写统一走 `shared/yaml.ts`（JSON_SCHEMA），不再把日期转成时间戳、不再规范化数字进制、不破坏注释之外的数据。
- **插件安装 scoped 包名解析错误**：`@deepseek-ai/xxx` 等 scoped 包安装后 bundle 状态误报，现正确解析包名；安装 / 卸载参数增加 npm 包名规范校验（拒绝 `-` 开头等注入面）。
- **异地同步：已删除会话会在下次拉取时复活**：同步在复制之外增加按会话 id 的对齐删除，删除操作可经 git 传播。
- **同步强制「以远端为准」不先 fetch**：`reset --hard` 前先 fetch 远端，避免回退到过期引用。
- **同步远端地址未校验**：仅接受 http(s) / ssh / git 协议，拒绝前导 `-`；配置保存失败时给出明确提示。
- **应用版本号恒显示 0.1.0**：`AppGetInfo` 改用 `app.getVersion()`（打包后 npm_package_version 环境变量不再注入）。
- **渲染层多处确认框取消误报「界面异常」**：ApiTab / PluginTab 的 `ElMessageBox.confirm` 取消改为静默返回。
- **Sidebar 视图对勾图标未导入**：`CircleCheckFilled` 补导入（此前运行时渲染失败、typecheck 不拦截）。
- **Sidebar 三处下拉菜单混入字面 `\n` 文本**：已删除，菜单项间不再显示伪影。
- **切换 dsh 内置侧边栏 CSS 累积**：insertCSS 按 key 先移除旧规则再注入，避免多次切换累积样式表。
- **渲染层 store 无 catch**：service.refresh / migrate.scan 失败不再产生 unhandled rejection。
- **GeneralTab / ApiTab 加载失败会覆盖真实配置**：加载失败时禁用保存按钮并提示，避免用默认值清空 apiKey。
- **BackupTab / SyncTab 保存失败静默**：补失败提示；SyncTab 冲突判断改为结构化 `conflict` 字段（不再字符串匹配）。
- **Wizard 下一步无防抖**：双击「下一步」会跳过环境检测直达完成页，现加 in-flight 守卫。
- **ServiceTab 开机自启设置失败不回滚**：开关状态与系统登录项保持一致。

### 优化（冗余 / 简化）

- 删除死代码：`stores/sessions.ts`（整文件零引用）、`SettingsTabShell.vue`（占位组件）、`shared/ipc.ts` 的 `AppVersionInfo` 接口。
- `ipc.ts` 三个同构广播函数合并为通用 `broadcast(channel, payload)`。
- `plugins.ts` 的 `dshEnv` 不再重复展开 `buildChildEnv`（`buildDshEnv` 内部已包含）。
- `dshUi.ts` 的 `writeShowDshSidebar` 改用原子写（tmp + rename）。
- 新增 `src/shared/yaml.ts` 公共模块（`loadYamlObject` / `loadYamlAny` / `dumpYaml`），apiConfig / dshUi / migrate 三处复用。
- 新增 `src/main/updater.ts` 更新模块（设置 / 检查 / 下载 / 应用 / 自动调度），含 16 个单元测试。
- `sync.ts` 新增 `isValidRemoteUrl` / `pruneMissing`（含测试）。

### 测试

- 单测从 160 增至 **181**（updater 16 + sync 5），全部通过；typecheck（tsc + vue-tsc）全绿。

## [0.1.0] - 2026-08-15

### 新增

- DSH 桌面首个可用版本：12 节规格（M1~M7）全部落地。
- 便携绿色版：全部运行环境与数据收敛在单一工作文件夹，零注册表 / %APPDATA% 残留，整文件夹可迁移。
- 一键安装 Node / npm / pnpm / Git / dsh；真实 dsh 会话（web 界面 + 对话 + 侧边栏 + 分组 / 归档 / 收藏）。
- 会话导入（目录 / 文件 / zip）、备份与恢复、异地同步（Git）、模型与 API 配置、功能插件与技能市场。
- 系统托盘、开机自启、窗口状态记忆、日志查看与导出、出厂重置。
