# Dialogue Visualization

> 看清 Claude Code / Codex 调用大模型 API 时，到底发送了什么数据。

平时接入大模型 API，你通常看不到客户端到底拼了什么发出去——系统提示词、完整对话历史、工具定义、模型参数都藏在"黑箱"里。本工具把这些请求的数据结构可视化出来，支持 Claude Code 与 Codex CLI / Codex Desktop 双客户端。

## 当前版本 v0.11.0

启动后自动扫描本地历史会话日志，也支持本地转发代理实时捕获，并用多个视图把每次 API 请求和完整对话流拆开给你看。

### 功能

- **多客户端支持**：Claude Code（CLI / VS Code / Desktop 3p）+ Codex CLI / Codex Desktop / Codex VS Code / Codex Work
- **自动扫描**：启动即扫描 `~/.claude/projects/**/*.jsonl` 与 `~/.codex/sessions/**/rollout-*.jsonl`，列出所有历史会话，点击即看
- **实时转发代理**：本地 localhost 代理伪装成 API 上游，自动改写客户端配置并注入共享密钥，捕获完整请求体后原样转发，不影响客户端正常工作
- **透明对话流**：像聊天界面，但露出平时藏起来的 system、tool_use、tool_result、thinking、reasoning
- **API 请求明细**：单次请求拆成 system / params / messages / tools / response，一眼看清到底发了什么
- **Token 用量**：按 round 聚合的堆叠柱状图，支持大会话自适应分桶、模型名、真实用量/估算标识
- **JSON 树**：可折叠树，按字段类型配色，精确查看请求的完整结构
- **原始日志**：按顺序列出 JSONL / rollout 每一行，点击展开看完整 JSON，支持按类型筛选
- **高效解析与恢复**：会话扁平化存储 + 按需切片；代理配置变更带备份与启动自愈，异常退出也能恢复

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 运行测试
npm test

# 构建
npm run build
```

> 需要 Node.js 18+ 和 npm。Electron 会在首次 `npm install` 时下载二进制。

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面框架 | Electron + electron-vite |
| 前端 | React 18 + TypeScript |
| 状态 | zustand |
| 代理 | Express + undici（捕获 + 转发） |
| 编辑器 | CodeMirror 6（JSON / 代码高亮） |
| 测试 | Vitest |
| 持久化 | JSON 文件（v1） |

## 架构

```
Claude Code 会话 JSONL (~/.claude/projects/)
Codex rollout JSONL (~/.codex/sessions/ + archived_sessions/)
        │
        ▼
┌─────────────────────────────────────────────┐
│  主进程 (Node.js/TS)                          │
│  ├─ adapters/claude-log.ts                   │ 扫描 + 解析 Claude JSONL
│  ├─ adapters/codex-log.ts                    │ 扫描 + 解析 Codex rollout
│  ├─ model/types.ts + normalizer.ts           │ 统一数据模型 + 双格式归一
│  ├─ proxy/server.ts + sse.ts                 │ 本地转发代理 + 流式捕获
│  ├─ store/persistent-store.ts                │ 实时捕获会话持久化
│  ├─ configGuard.ts                           │ 配置备份 / 还原 / 启动自愈
│  └─ IPC handlers                             │ sessions / live / proxy / export
└─────────────────────────────────────────────┘
        │ IPC
        ▼
┌─────────────────────────────────────────────┐
│  渲染进程 (React/TS)                          │
│  ├─ Sidebar                                  │ 会话列表（按来源分组）
│  ├─ ViewSwitcher                             │ 视图切换 + 捕获控制
│  └─ views/                                   │
│     ├─ ChatFlowView                          │ 透明对话流
│     ├─ ApiInspectorView                      │ API 请求明细
│     ├─ TokenChartView                        │ Token 用量按 round 图
│     ├─ JsonTreeView                          │ JSON 树
│     └─ RawLogView                            │ 原始日志
└─────────────────────────────────────────────┘
```

### 数据模型

- **Session**：一个会话，含 `conversation`（扁平对话数组）+ `requests`（每个 API 请求一条）+ `rawLines`（原始日志行）
- **ApiRequest**：单次请求，含 `system`、`messageCount`（消息切片边界）、`tools`、`params`、`response.usage`、`inputMessages`（代理捕获专用）
- **Message**：`role` + `content: ContentBlock[]` + `meta`
- **ContentBlock**：text / tool_use / tool_result / image / thinking
- **MessageMeta**：timestamp、uuid、parentUuid、isSidechain、effort、cwd、gitBranch、model、originator 等

## 项目结构

```
src/
├─ main/                     # Electron 主进程
│  ├─ adapters/              # 数据接入
│  │  ├─ claude-log.ts       # 扫描 + 解析 Claude Code JSONL
│  │  └─ codex-log.ts        # 扫描 + 解析 Codex rollout
│  ├─ model/                 # 数据模型 + normalizer
│  │  ├─ types.ts
│  │  └─ normalizer.ts
│  ├─ proxy/                 # 转发代理 + SSE
│  │  ├─ server.ts
│  │  ├─ sse.ts
│  │  ├─ responses-sse.ts
│  │  └─ upstream.ts
│  ├─ store/                 # 持久化
│  │  ├─ persistent-store.ts # live capture 文件存储
│  │  └─ session-store.ts
│  ├─ utils/                 # reasoning / token 工具
│  ├─ configGuard.ts         # 配置备份 / 还原 / 自愈
│  ├─ ipc.ts                 # IPC handlers
│  └─ index.ts               # app 入口
├─ preload/                  # contextBridge
└─ renderer/                 # React 前端
   ├─ components/            # Sidebar、ViewSwitcher、目录、复制条等
   ├─ views/                 # ChatFlowView、ApiInspectorView、TokenChartView、JsonTreeView、RawLogView
   ├─ hooks/                 # 可调面板、虚拟列表引用
   ├─ utils/                 # 命令解析、token 估算、复制、请求选择
   ├─ store.ts               # zustand
   └─ App.tsx
```

## 工作原理

### 1. 历史日志扫描

- **Claude Code**：递归收集 `~/.claude/projects/**/*.jsonl`，跳过子代理会话；列表只读头 10 行 + 尾 30 行提取标题、目录、时间，点击时再全量解析
- **Codex**：递归收集 `~/.codex/sessions/**/rollout-*.jsonl` 与 `archived_sessions/**`，再读取 `session_index.jsonl` 覆盖线程标题；点开会话时再全量解析

### 2. 会话解析与归一

- 全量解析 JSONL / rollout，构建扁平 `conversation` 数组
- 每个 assistant 消息对应一次 API 调用，记为一条 `ApiRequest`，并记录 `messageCount` 切片边界与 `response.usage`
- 把 Claude 的 snake_case 字段与 Codex 的 Responses 格式归一到统一模型，`content` 统一成数组

### 3. 实时代理捕获

- 启动本地代理，支持 Anthropic Messages 与 OpenAI Responses 两条路径
- 自动改写客户端配置并注入共享密钥；请求经代理原样转发到上游，同时捕获请求体和 SSE / 非流式响应
- 实时会话持久化到本地文件；应用崩溃或异常退出后，下次启动会自动还原用户配置

### 4. 渲染

- 对话流视图渲染整段 `conversation`，并支持虚拟滚动
- API 请求明细视图把单次请求拆成可读结构
- Token 用量视图按 round 聚合输入 / 输出 / cache 用量，支持自适应分桶与标签节流
- JSON 树视图展示完整请求结构；原始日志视图展示未过滤的原始事件流

## 视图总览

| 视图 | 说明 |
|----|------|
| 💬 对话流 | 按角色渲染完整对话，暴露 system / tool_use / tool_result / thinking |
| 📡 API 请求明细 | 单次请求的系统提示词、参数、tools、messages、response |
| 📊 Token 用量 | 按 round 展示输入、输出、缓存创建、缓存读取，真实/估算一眼区分 |
| 🌳 JSON 树 | 可折叠查看请求完整字段结构 |
| 📄 原始日志 | 按顺序查看原始 JSONL / rollout 行，适合排查边界情况 |

## 已知局限

- 历史日志中可能仍缺少运行时注入的 system 提示词、tools 定义、模型参数；完整真相以**实时代理捕获**为准
- Codex 历史日志与实时代理能力仍可能在后续版本继续扩展
- macOS 包未签名；首次打开需手动允许

## 路线图

- Claude 桌面版 3p profile 更完整的接入与切换体验
- 时间线 / 上下文增长视图
- 结构分解面板视图
- 更多客户端与供应商的兼容层（如需）
- 大会话场景下的性能与存储优化

## 开发

```bash
# 类型检查
npx tsc --noEmit

# 单元测试（watch 模式）
npm run test:watch

# 打包桌面应用
npm run build && npx electron-builder
```

## 致谢

本项目在设计与实现上参考了 [cc-switch](https://github.com/farion1231/cc-switch) 的以下模块（用 Node/TypeScript 重写）：

- 会话扫描与 JSONL 解析
- token 用量解析与缓存语义
- SSE 流式处理与 UTF-8 边界
- Claude 桌面版 3p 配置

cc-switch 是一个成熟的多供应商 API 网关，本工具只借鉴其"扫描 + 解析"骨架，不做供应商路由与格式转换。

## License

GPL-3.0-or-later。详见 [LICENSE](LICENSE)。
