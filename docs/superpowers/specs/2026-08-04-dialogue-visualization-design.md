# Dialogue Visualization 设计文档

- **日期**：2026-08-04
- **状态**：已通过头脑风暴评审，待用户最终确认
- **参考实现**：cc-switch（`D:\project\cc-switch`）

## 1. 概述

### 1.1 目的

把 Claude Code / Codex 这些客户端调用大模型 API 时**实际发送的请求数据结构**可视化出来。用户对接大模型 API 时，通常看不到客户端到底拼了什么发出去（系统提示词、对话历史、工具定义、模型参数）。本工具让这些"黑箱"数据直观可见。

### 1.2 v1 范围

- **客户端**：Claude Code（CLI）+ Claude 桌面版
- **数据源**：自动扫描日志 + 实时转发代理
- **视图**：JSON 树、透明对话流、时间线/上下文增长、结构分解面板（四个都要）
- **技术栈**：Electron（Node.js/TS 后端 + React/TS 前端）

> 注：Codex（CLI）在 v2 加入。v1 的数据模型、代理端点结构、自动扫描框架都按"能平滑扩展到 Codex"来抽象，但 v1 不实现 Codex 适配器。

### 1.3 v2 及以后

- 加 Codex 适配器：`~/.codex/` 会话扫描 + 代理 `/v1/responses`、`/v1/chat/completions` 端点 + codex-normalizer.ts（v1 数据模型已抽象，复制成本低）
- 附加捕获模式（改配置抓已开会话）
- 会话量大时迁 SQLite

### 1.4 非目标（YAGNI）

- 不做多供应商路由/故障转移/格式互转（那是 cc-switch 的职责，我们只读不改）
- 不做云端、不上传
- 不做团队协作

## 2. 架构与模块划分

### 2.1 进程架构

Electron 双进程：

- **主进程（Node.js/TS）**：读文件、跑代理、解析、持久化
- **渲染进程（React/TS）**：四个视图渲染
- **IPC**：连接两边，代理实时更新用主进程主动推送

### 2.2 模块结构

```
dialogue-viz/
├─ src/
│  ├─ main/                      # 主进程
│  │  ├─ index.ts                # 窗口创建、app 生命周期
│  │  ├─ ipc/                    # IPC handlers
│  │  ├─ adapters/                # 数据接入
│  │  │  ├─ claude-log.ts         # 扫描+解析 Claude Code JSONL
│  │  │  ├─ codex-log.ts         # (v2) 扫描+解析 Codex 会话
│  │  │  └─ proxy-capture.ts      # 捕获转发请求
│  │  ├─ model/                   # 统一数据模型
│  │  │  ├─ types.ts              # Session/Request/Message/ContentBlock
│  │  │  └─ normalizer.ts         # Anthropic/OpenAI 格式 -> 统一
│  │  ├─ proxy/                   # 转发代理
│  │  │  └─ server.ts             # express 转发服务
│  │  └─ store/                   # 持久化
│  │     └─ session-store.ts      # 存捕获的会话
│  ├─ preload/
│  │  └─ index.ts                 # contextBridge 暴露安全 API
│  └─ renderer/                   # 前端
│     ├─ App.tsx
│     ├─ views/                   # 4 个视图组件
│     ├─ components/              # 会话列表侧栏、视图切换器
│     └─ store/                   # zustand 前端状态
├─ package.json
└─ electron-builder.yml
```

### 2.3 两条数据流

- **流 A · 日志自动扫描**：扫描固定位置 -> adapters/claude-log -> normalizer -> Session -> IPC -> 渲染
- **流 B · 实时代理**：Claude Code -> localhost 代理 -> 记录 -> normalizer -> Request -> IPC 推送 -> 渲染实时更新

两条流都汇入同一个统一数据模型，视图代码不关心数据来源。

## 3. 统一数据模型

### 3.1 类型层次

```typescript
// 会话 - 用户浏览的单位
interface Session {
  id: string;
  source: 'claude-code-log' | 'codex-log' | 'proxy-live';
  client: 'claude-code' | 'claude-desktop' | 'codex';
  clientVersion?: string;
  startedAt: number;
  endedAt?: number;
  title?: string;
  projectDir?: string;          // cwd
  requests: ApiRequest[];        // 每次 API 调用一条
  totalTokens?: number;
}

// 单次 API 请求 - "想看清的那个东西"的本体
interface ApiRequest {
  id: string;
  apiRequestId?: string;        // 原始响应 id
  timestamp: number;
  model: string;
  system: ContentBlock[];        // 归一成数组
  messages: Message[];
  tools?: ToolDef[];
  params: ModelParams;
  metadata?: Record<string, unknown>;
  response?: {                  // 模型返回（捕获到才有）
    content: ContentBlock[];
    stopReason: string;
    usage: TokenUsage;
  };
  // 派生
  transformMode?: boolean;       // 上游是否经 cc-switch 转换
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: ContentBlock[];       // 统一成数组
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
}

interface ModelParams {
  maxTokens: number;
  temperature?: number;
  topP?: number;
}

// 内容块（联合类型）
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: ContentBlock[] | string; isError?: boolean }
  | { type: 'image'; source: { type: string; data?: string; url?: string; mediaType: string } }
  | { type: 'thinking'; thinking: string; signature?: string };

// token 用量（借鉴 cc-switch 的 TokenUsage）
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  model?: string;               // 实际响应模型名
  messageId?: string;            // 响应 id，用于去重
}
```

### 3.2 归一化规则（normalizer 职责）

1. `system` 不论源是字符串还是数组，统一成 `ContentBlock[]`
2. `message.content` 不论字符串还是数组，统一成 `ContentBlock[]`
3. `tool_use` 与 `tool_result` 通过 `id`/`toolUseId` 配对关联
4. 请求和响应都保留。日志里通常只有 messages，代理能同时抓到 response + usage
5. 字段名用驼峰，源里的 snake_case（`max_tokens`、`input_tokens`）转换掉

### 3.3 为 v2 预留

OpenAI 格式（role/content/tool_calls/function_call）能映射到 `Message + ContentBlock`。加 Codex 时只需写 `codex-normalizer.ts`，视图代码零改动。

## 4. 数据接入层

### 4.1 适配器 A · 日志自动扫描（claude-log.ts / codex-log.ts）

**不手动导入**。启动时自动扫描固定位置，列出所有会话。

**Claude Code 会话**：
- 扫描 `~/.claude/projects/**/*.jsonl`，递归收集所有 `.jsonl`
- 跳过 `agent-` 开头的子代理会话
- 列表只需读每文件头 10 行 + 尾 30 行，提取元数据：sessionId、cwd、created_at、首条用户消息（标题）、last_active_at、summary
- 标题优先级：自定义标题 > 首条用户消息 > 目录名
- 点开某会话才全量解析该 JSONL
- 参考实现：cc-switch `session_manager/providers/claude.rs`

**Codex 会话**（v2）：
- 读 `~/.codex/state_5.sqlite`（线程元数据）+ rollout 文件
- 参考实现：cc-switch `codex_state_db.rs` + `session_manager/providers/codex.rs`

**Claude Code JSONL 格式要点**（实现时处理）：
- 每行有 `type`（user/assistant/custom-title/file-history-snapshot）
- 消息在 `message` 字段（含 role/content）
- `content` 可能是字符串或 content 块数组
- **tool_result 包在 user 消息里**，需重分类为 "tool" 角色
- `isMeta:true` 的元数据行跳过
- `<local-command-caveat>`、`<command-name>` 等斜杠命令噪音过滤
- 请求边界重建：每个 assistant 消息 = 之前一次 API 调用的响应；第 N 个 ApiRequest 的 messages = 截至第 N 个 user/tool_result 之前的所有消息

**已知局限**：Claude Code 的 JSONL 可能不含 system 提示词、tools 定义、model 参数（运行时注入）。日志导入的 Session 这些字段可能为空——这正是代理要补的。实现时第一步就读一个真实 JSONL 确认 schema。

### 4.2 适配器 B · 转发代理（proxy/server.ts）

**原理**：本地起一个 express 服务，伪装成 Anthropic API。Claude Code 把请求发给它，它记录后转发给真 API，再把响应传回。

**端点**（借鉴 cc-switch，v1 先做 messages，其余为 v2 Codex 预留）：
- `POST /v1/messages` - Claude API
- `POST /v1/responses` - Codex（OpenAI Responses）
- `POST /v1/chat/completions` - Codex（旧 Chat）
- `GET /v1/models` - 可达性检查

**关键点**：
- **headers 透传**：`x-api-key`、`anthropic-version` 等原样转发，代理不碰密钥
- **流式响应**：Anthropic 用 SSE。代理边接收 SSE chunk 边转发给 Claude Code，同时累积成完整响应再归一。正确处理 UTF-8 跨 chunk 边界（参考 cc-switch `sse.rs` 的 `append_utf8_safe`）
- **实时推送**：每捕获一个请求，通过 IPC `proxy:live-update` 推给渲染进程
- **只读不改**：记录请求体原样，转发原样。不做格式转换、不改 model
- **上游可配置**：代理的转发目标（上游 URL）可配置：
  - `https://api.anthropic.com`（官方）
  - `http://localhost:<cc-switch端口>`（串接 cc-switch）
  - `https://api.deepseek.com` 等第三方直连

### 4.3 两个适配器的互补关系

| 字段 | 日志扫描 | 转发代理 |
|------|---------|---------|
| messages（对话） | ✅ | ✅ |
| system 提示词 | ❓可能没有 | ✅完整 |
| tools 定义 | ❓可能没有 | ✅完整 |
| model 参数 | ❓可能没有 | ✅完整 |
| response + token 用量 | ❓部分 | ✅完整 |
| 历史会话回看 | ✅ | ❌只看当下 |

日志适合回看历史，代理适合看清每次请求的完整真相。

### 4.4 与 cc-switch 共存

**用户用 cc-switch 配置供应商时**，我们两种情况都能工作：

1. **供应商原生支持 Anthropic 格式**（如 DeepSeek）：cc-switch 只改配置不跑代理。Claude Code 直连供应商。我们的代理上游直接填供应商地址。
2. **供应商需要格式转换**（如纯 GPT-4o 中转）：cc-switch 必须跑代理做转换。我们串在 cc-switch 前面：`Claude Code -> 我们的代理 -> cc-switch -> 供应商`。我们的上游填 cc-switch 地址。我们看到的永远是 Anthropic 格式（Claude Code 原始发出 + cc-switch 转回的响应），转换对我们透明。

**重要原则**：我们的代理不做格式转换。需要转换时必须靠 cc-switch（或类似工具）在后面做。非原生供应商 = 必须先装 cc-switch。

**模型名"伪装"现象**：转换场景下，请求里 model 可能是 `claude-sonnet-5`（Claude Code 以为在跟 Claude 说话），但响应其实是 GPT 生成的。UI 可标注"上游经 cc-switch 转换，实际模型可能不同"。

### 4.5 工作流 · 如何成为 Claude Code 的上游

**不需要永久改 Claude Code 配置文件**。利用环境变量优先级（env > settings.json > 默认），用"环境变量覆盖 + 启动子进程"：

1. 用户点"开始捕获"，工具读 `~/.claude/settings.json` 探测当前上游（可能是 cc-switch、DeepSeek 或官方）
2. 工具自动配置自己的代理上游 = 探测到的地址
3. 工具启动 Claude Code 子进程，注入 `ANTHROPIC_BASE_URL=http://localhost:<我们的端口>`
4. 用户正常使用 Claude Code，请求被代理捕获并实时可视化
5. 用户退出 Claude Code，子进程结束，环境变量消失，settings.json 从未改动，cc-switch 配置完好

**Claude 桌面版的接入**：通过写 3p 部署 profile（`inferenceGatewayBaseUrl` 指向我们的代理 + `deploymentMode:"3p"`），参考 cc-switch `claude_desktop_config.rs`。

**模式 B · 附加捕获**（备选，v1 不做）：改 settings.json 指向我们的代理，重启已开的 Claude Code。能抓已开会话，但和 cc-switch 抢配置。

## 5. 四个视图

四个视图共享同一个当前选中的 ApiRequest，互相联动。

### 5.1 视图 1 · JSON 树状浏览器

- **数据源**：ApiRequest 直接序列化
- **显示**：可折叠树，按字段类型配色
- **交互**：点击折叠/展开；大块（system、tools）默认折叠；显示每块字数/token；搜索过滤；右键复制路径或值
- **价值**：看到请求精确结构，理解 Anthropic API 字段组织

### 5.2 视图 2 · 透明对话流

- **数据源**：system + messages，tool_use 与 tool_result 按 id 配对
- **显示**：聊天气泡，但露出平时藏的：system（默认折叠）、tool_use（名称+输入）、tool_result、thinking 块
- **交互**：点击气泡看原始 content 块；点击 system 展开全文；tool_use 与对应 result 高亮关联
- **价值**：直观看到完整对话含工具调用往返

### 5.3 视图 3 · 时间线 + 上下文增长

- **数据源**：Session.requests[].response.usage
- **显示**：每条请求一根柱子，高度=输入 token（因 messages 累积而增长）。堆叠：cache_read / fresh input / cache_creation。红色标记接近上下文上限
- **交互**：悬停看 token 明细；点击柱子跳到该请求的其它视图
- **价值**：看清上下文怎么越滚越大及缓存命中率

### 5.4 视图 4 · 结构分解面板

- **数据源**：ApiRequest 拆成四块
- **显示**：四宫格（system/参数/messages/tools），每块给摘要（字数/token/数量）。显示各块占上下文比例
- **交互**：点击面板展开完整内容；tools 面板列出所有工具名
- **价值**：一眼看清请求由什么组成及 token 占比

### 5.5 联动

在任一视图选中/点击某条请求，其它三个视图同步切换。典型流：会话列表选 Session -> 时间线看哪条 token 异常 -> 点柱子 -> 切透明对话流看内容 -> 切结构分解看哪部分占大头 -> 切 JSON 树看精确字段。

## 6. UI 流程与会话管理

### 6.1 应用布局

- **左侧栏**：会话列表（按客户端分组，支持搜索）
- **顶栏**：导入按钮、开始捕获按钮、代理状态、当前会话信息、视图切换器
- **主区**：当前视图内容
- **底栏**：当前请求信息、总 token、成本

### 6.2 两个核心流程

- **流程 A · 自动扫描发现**（主）：启动时扫描固定位置，所有历史会话自动列出，点击即看。手动导入降为备用。
- **流程 B · 实时捕获**：点"开始捕获" -> 探测上游 -> 配置代理 -> 启动 Claude Code（env 覆盖）-> 实时流入 -> 退出存档。

### 6.3 会话存储

- 每个会话一个 JSON 文件，存 `%APPDATA%\DialogueViz\sessions\<uuid>.json`
- 含会话元数据 + 所有 ApiRequest（含原始请求体和响应）
- 代理捕获自动存档；日志扫描按需读取原文件
- v1 不用 SQLite（会话量不大，JSON 简单可读易调试）

### 6.4 侧栏三类来源

1. 自动发现的日志会话（只读，v1 扫描 `~/.claude/`；v2 加 `~/.codex/`）
2. 本工具实时捕获的会话（存 app 数据目录）
3. 手动导入（备用，非标准位置）

## 7. 错误处理

| 场景 | 处理 |
|------|------|
| 上游不可达 / 返回错误 | 错误响应原样转回 Claude Code（不影响它工作），UI 标记该请求失败 |
| 端口被占用 | 自动换端口或提示用户 |
| JSONL 损坏行 | 跳过坏行并警告，不中断整个扫描/解析 |
| SSE 流中断 | 保留已收到的部分，标记响应不完整 |
| Claude Code 不在 PATH | 借 cc-switch 的候选路径查找逻辑找 claude 可执行文件 |
| settings.json 无 BASE_URL | 默认上游 = 官方 api.anthropic.com |
| UTF-8 跨 chunk 分裂 | 正确累积不完整字节序列（参考 cc-switch `append_utf8_safe`） |

**原则**：错误处理优先不影响 Claude Code 正常工作。

## 8. 测试策略

### 8.1 单元测试

- **normalizer**：各格式归一，重点测 cache 语义（Claude input 不含 cache；OpenAI/Codex input 含 cache，计算成本要扣除）
- **token 解析器**：四种 API 格式（Claude/OpenAI Chat/Codex Responses/Gemini）+ 流式。用 cc-switch `proxy/usage/parser.rs` 的测试用例当参考
- **日志适配器**：请求边界重建逻辑、tool_result 重分类、噪音过滤

### 8.2 集成测试

- 代理端到端：mock 上游，验证捕获 + 转发 + SSE 流式
- 环境变量覆盖启动：验证 Claude Code 真的走我们的代理

### 8.3 测试夹具

真实采样几条 Claude Code JSONL + 各 API 的样本响应存为 fixtures。

## 9. 技术决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 桌面框架 | Electron | 一种语言（TS）、生态最大、调试方便；用户不写 Rust |
| 前端框架 | React + TS | 生态成熟，适合密集可视化 |
| 状态管理 | zustand | 轻量 |
| 代理库 | express + undici | Node 生态主流 |
| 数据模型 | 抽象统一模型 | 为 v2 加 Codex 预留，视图零改动 |
| 代理方式 | 转发端点（BASE_URL 覆盖）| 不做 MITM，不用装证书 |
| 会话存储 | JSON 文件 | v1 简单；量大再迁 SQLite |
| 数据接入 | 自动扫描 + 代理 | 日志自动发现历史，代理看实时完整真相 |

## 10. 参考实现（cc-switch）

实现时可直接参考 cc-switch（`D:\project\cc-switch\cc-switch\src-tauri\src\`）的以下模块，用 Node/TS 重写：

- `proxy/server.rs` + `handlers.rs` - 代理端点结构
- `proxy/sse.rs` - SSE 解析 + UTF-8 边界处理（`append_utf8_safe`、`take_sse_block`）
- `proxy/usage/parser.rs` - 四种 API 的 token 解析
- `proxy/usage/calculator.rs` - 成本计算 + cache 语义
- `session_manager/providers/claude.rs` - Claude Code 会话扫描 + JSONL 解析
- `session_manager/providers/codex.rs` + `codex_state_db.rs` - Codex 会话扫描
- `claude_desktop_config.rs` - Claude 桌面版 3p profile 写入

**跳过**：cc-switch 的供应商路由/故障转移/格式互转/模型映射/多供应商配置管理（我们不需要）。

---

**下一步**：用户确认本规格后，调用 writing-plans 技能创建实现计划。
