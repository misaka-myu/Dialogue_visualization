# Dialogue Visualization

> 看清 Claude Code / Codex 调用大模型 API 时，到底发送了什么数据。

平时接入大模型 API，你通常看不到客户端到底拼了什么发出去--系统提示词、完整对话历史、工具定义、模型参数都藏在"黑箱"里。本工具把这些请求的数据结构可视化出来。

## 当前版本 v0.1（MVP）

自动扫描本地 Claude Code 会话记录（JSONL），用两个视图可视化每次 API 请求的数据结构。

### 功能

- **自动扫描**：启动即扫描 `~/.claude/projects/**/*.jsonl`，列出所有历史会话，点击即看
- **透明对话流**：像聊天界面，但露出平时藏起来的 system 提示词、tool_use 调用、tool_result 返回、thinking 块
- **JSON 树**：可折叠树，按字段类型配色，精确查看请求的完整结构
- **高效解析**：会话只存一份扁平对话数组 + 按需切片，长会话不爆内存；渲染封顶 + 大内容截断

### 截图

（待补充）

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
| 前端 | React + TypeScript |
| 状态 | zustand |
| 测试 | Vitest |
| 持久化 | JSON 文件（v1） |

## 架构

```
Claude Code 会话 JSONL (~/.claude/projects/)
        │
        ▼
┌─────────────────────────────┐
│  主进程 (Node.js/TS)          │
│  ├─ adapters/claude-log.ts   │ 扫描 + 解析 JSONL
│  ├─ model/normalizer.ts      │ Anthropic 格式归一
│  └─ IPC handlers              │ sessions:list / sessions:load
└─────────────────────────────┘
        │ IPC
        ▼
┌─────────────────────────────┐
│  渲染进程 (React/TS)          │
│  ├─ Sidebar                  │ 会话列表
│  ├─ ViewSwitcher             │ 视图切换
│  └─ views/                   │
│     ├─ ChatFlowView          │ 透明对话流
│     └─ JsonTreeView          │ JSON 树
└─────────────────────────────┘
```

### 数据模型

- **Session**：一个会话，含 `conversation`（扁平对话数组）+ `requests`（每个 API 请求一条）
- **ApiRequest**：单次请求，含 `model`、`system`、`messageCount`（消息切片边界）、`tools`、`params`、`response`
- **Message**：`role` + `content: ContentBlock[]`
- **ContentBlock**：联合类型（text / tool_use / tool_result / image / thinking）

## 项目结构

```
src/
├─ main/                 # Electron 主进程
│  ├─ adapters/          # 数据接入（claude-log）
│  ├─ model/             # 数据模型 + normalizer
│  ├─ store/             # 会话持久化
│  ├─ ipc.ts             # IPC handlers
│  └─ index.ts           # app 入口
├─ preload/              # contextBridge
└─ renderer/             # React 前端
   ├─ components/        # Sidebar、ViewSwitcher
   ├─ views/             # ChatFlowView、JsonTreeView
   ├─ store.ts           # zustand
   └─ App.tsx
```

## 工作原理

1. **扫描**：递归收集 `~/.claude/projects/` 下所有 `.jsonl`，跳过子代理会话。列表只读每文件头 10 行 + 尾 30 行提取元数据（标题、目录、时间）。
2. **解析**：点开会话时全量解析 JSONL，构建扁平 `conversation` 数组。每个 assistant 消息对应一次 API 调用，记为一条 `ApiRequest`（含 `messageCount` 切片边界 + response）。
3. **归一**：把 Anthropic 的 snake_case 字段（`max_tokens`、`input_tokens` 等）转成驼峰，content 统一成数组。
4. **渲染**：对话流视图渲染整段 `conversation`（封顶 200 条）；JSON 树视图展示请求结构。

## 已知局限（v0.1）

- 只支持 Claude Code（CLI）会话日志的回看
- 日志可能不含 system 提示词、tools 定义、model 参数（Claude Code 运行时注入，不在 JSONL 里）--这些要靠实时代理捕获（见路线图）
- 时间线视图、结构分解视图、实时代理捕获、Claude 桌面版、Codex 适配器尚未实现（见路线图）

## 路线图

**v0.2（计划中）**
- 实时转发代理：本地伪装成 Anthropic API，捕获 Claude Code 发出的完整请求体（含 system/tools/params）
- 时间线 + 上下文增长视图
- 结构分解面板视图
- Claude 桌面版接入（3p 部署 profile）
- Codex 适配器（日志扫描 + 代理端点）

详见设计文档：`docs/superpowers/specs/2026-08-04-dialogue-visualization-design.md`

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

- 会话扫描与 JSONL 解析（`session_manager/providers/claude.rs`）
- token 用量解析与缓存语义（`proxy/usage/parser.rs`）
- SSE 流式处理与 UTF-8 边界（`proxy/sse.rs`）
- Claude 桌面版 3p 配置（`claude_desktop_config.rs`）

cc-switch 是一个成熟的多供应商 API 网关，本工具只借鉴其"扫描 + 解析"骨架，不做供应商路由与格式转换。

## License

GPL-3.0-or-later。详见 [LICENSE](LICENSE)。
