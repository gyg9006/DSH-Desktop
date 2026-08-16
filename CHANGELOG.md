# 更新日志（CHANGELOG）

本项目的所有显著变更都会记录在此文件中。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
