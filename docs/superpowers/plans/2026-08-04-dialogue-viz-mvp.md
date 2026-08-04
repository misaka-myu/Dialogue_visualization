# Dialogue Visualization MVP 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 构建一个 Electron 桌面应用，自动扫描 Claude Code 的本地会话 JSONL，把每次 API 请求的数据结构用 JSON 树和透明对话流两个视图可视化出来。

**架构：** Electron 主进程（Node/TS）负责扫描、解析、持久化；渲染进程（React/TS）负责两个视图；IPC 连接两边。统一数据模型把 Anthropic 格式归一成内部表示，两个视图都基于它渲染。

**技术栈：** Electron + electron-vite + React + TypeScript + Vitest + zustand

**本计划范围（MVP）：** 脚手架 + 数据模型 + Anthropic normalizer + Claude Code 日志自动扫描/解析 + 会话存储 + IPC + 侧栏 + JSON 树视图 + 透明对话流视图。

**不在本计划（后续计划 2）：** 实时代理捕获、时间线视图、结构分解视图、Claude 桌面版接入、Codex 适配器。

**参考规格：** `docs/superpowers/specs/2026-08-04-dialogue-visualization-design.md`

---

## 文件结构

```
dialogue-viz/
├─ package.json                      # 依赖与脚本
├─ tsconfig.json                     # TS 配置
├─ tsconfig.node.json                # 主进程 TS 配置
├─ electron.vite.config.ts           # electron-vite 配置
├─ electron-builder.yml              # 打包配置
├─ index.html                        # 渲染进程入口 HTML
├─ src/
│  ├─ main/                          # Electron 主进程
│  │  ├─ index.ts                    # app 生命周期、窗口创建
│  │  ├─ ipc.ts                       # IPC handlers 注册
│  │  ├─ adapters/
│  │  │  └─ claude-log.ts            # 扫描+解析 Claude Code JSONL
│  │  ├─ model/
│  │  │  ├─ types.ts                  # 统一数据模型类型
│  │  │  └─ normalizer.ts            # Anthropic 格式 -> 统一
│  │  └─ store/
│  │     └─ session-store.ts         # JSON 会话持久化
│  ├─ preload/
│  │  └─ index.ts                     # contextBridge 暴露安全 API
│  └─ renderer/
│     ├─ main.tsx                     # React 入口
│     ├─ App.tsx                      # 根组件、布局
│     ├─ store.ts                     # zustand 状态
│     ├─ components/
│     │  ├─ Sidebar.tsx               # 会话列表
│     │  └─ ViewSwitcher.tsx          # 视图切换
│     └─ views/
│        ├─ JsonTreeView.tsx          # JSON 树视图
│        └─ ChatFlowView.tsx          # 透明对话流视图
├─ tests/
│  ├─ model/
│  │  └─ normalizer.test.ts
│  ├─ adapters/
│  │  └─ claude-log.test.ts
│  └─ fixtures/
│     ├─ simple-session.jsonl
│     └─ tool-use-session.jsonl
```

---

## 任务 1：项目脚手架

**文件：**
- 创建：`package.json`、`tsconfig.json`、`tsconfig.node.json`、`electron.vite.config.ts`、`electron-builder.yml`、`index.html`

- [ ] **步骤 1：创建 package.json**

```json
{
  "name": "dialogue-viz",
  "version": "0.1.0",
  "description": "Visualize the request data Claude Code/Codex send to LLM APIs",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-vite": "^2.3.0",
    "electron-builder": "^24.13.3",
    "vite": "^5.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "zustand": "^4.5.0",
    "@vitejs/plugin-react": "^4.3.0"
  }
}
```

- [ ] **步骤 2：创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **步骤 3：创建 tsconfig.node.json**（主进程用）

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "module": "CommonJS", "noEmit": false },
  "include": ["src/main/**/*", "src/preload/**/*", "electron.vite.config.ts"]
}
```

- [ ] **步骤 4：创建 electron.vite.config.ts**

```typescript
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } } },
  preload: { build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } } },
  renderer: {
    root: '.',
    plugins: [react()],
    resolve: { alias: { '@': resolve(__dirname, 'src') } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'index.html') } } }
  }
});
```

- [ ] **步骤 5：创建 electron-builder.yml**

```yaml
appId: com.dialogueviz.app
productName: DialogueViz
directories:
  output: dist
files:
  - out/**/*
```

- [ ] **步骤 6：创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dialogue Visualization</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

- [ ] **步骤 7：安装依赖**

运行：`npm install`
预期：成功安装，生成 node_modules 和 package-lock.json

- [ ] **步骤 8：Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold electron-vite + react + ts project"
```

---

## 任务 2：数据模型类型

**文件：**
- 创建：`src/main/model/types.ts`

- [ ] **步骤 1：创建类型定义文件**

```typescript
// src/main/model/types.ts

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: ContentBlock[] | string; isError?: boolean }
  | { type: 'image'; source: { type: string; data?: string; url?: string; mediaType: string } }
  | { type: 'thinking'; thinking: string; signature?: string };

export interface Message {
  role: Role;
  content: ContentBlock[];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ModelParams {
  maxTokens: number;
  temperature?: number;
  topP?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  model?: string;
  messageId?: string;
}

export interface ApiResponse {
  content: ContentBlock[];
  stopReason: string;
  usage: TokenUsage;
}

export interface ApiRequest {
  id: string;
  apiRequestId?: string;
  timestamp: number;
  model: string;
  system: ContentBlock[];
  messages: Message[];
  tools?: ToolDef[];
  params: ModelParams;
  metadata?: Record<string, unknown>;
  response?: ApiResponse;
  transformMode?: boolean;
}

export interface Session {
  id: string;
  source: 'claude-code-log' | 'codex-log' | 'proxy-live';
  client: 'claude-code' | 'claude-desktop' | 'codex';
  startedAt: number;
  endedAt?: number;
  title?: string;
  projectDir?: string;
  requests: ApiRequest[];
  totalTokens?: number;
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}
```

- [ ] **步骤 2：验证编译**

运行：`npx tsc --noEmit`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add src/main/model/types.ts
git commit -m "feat(model): define unified data model types"
```

---

## 任务 3：Anthropic normalizer（TDD）

把 Anthropic Messages API 的原始请求/响应体归一成统一模型。规则：system 统一成数组、content 统一成数组、snake_case 转驼峰、tool_use/tool_result 保留 id 关联。

**文件：**
- 创建：`src/main/model/normalizer.ts`
- 测试：`tests/model/normalizer.test.ts`

- [ ] **步骤 1：编写失败的测试**

```typescript
// tests/model/normalizer.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeAnthropicRequest, normalizeAnthropicResponse, normalizeContent } from '../../src/main/model/normalizer';

describe('normalizeContent', () => {
  it('把字符串 content 归一成单元素 text 数组', () => {
    expect(normalizeContent('hello')).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('把数组 content 归一成 ContentBlock[]', () => {
    const input = [{ type: 'text', text: 'hi' }];
    expect(normalizeContent(input)).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('把 tool_use 块的 tool_use_id 转成 toolUseId', () => {
    const input = [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'result' }];
    expect(normalizeContent(input)).toEqual([
      { type: 'tool_result', toolUseId: 'tu_1', content: 'result', isError: undefined },
    ]);
  });

  it('忽略未知类型的块', () => {
    expect(normalizeContent([{ type: 'unknown' }])).toEqual([]);
  });
});

describe('normalizeAnthropicRequest', () => {
  it('归一 system 字符串、messages、params（snake_case 转驼峰）', () => {
    const body = {
      model: 'claude-sonnet-5',
      system: '你是 Claude Code',
      messages: [{ role: 'user', content: '帮我修 bug' }],
      max_tokens: 8192,
      temperature: 1.0,
    };
    const req = normalizeAnthropicRequest(body, 1000, 'r1');
    expect(req.model).toBe('claude-sonnet-5');
    expect(req.system).toEqual([{ type: 'text', text: '你是 Claude Code' }]);
    expect(req.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '帮我修 bug' }] }]);
    expect(req.params).toEqual({ maxTokens: 8192, temperature: 1.0 });
    expect(req.tools).toBeUndefined();
  });

  it('归一 system 数组形式', () => {
    const body = { model: 'm', system: [{ type: 'text', text: 'sys' }], messages: [], max_tokens: 100 };
    const req = normalizeAnthropicRequest(body, 0, 'r2');
    expect(req.system).toEqual([{ type: 'text', text: 'sys' }]);
  });

  it('归一 tools 定义（input_schema -> inputSchema）', () => {
    const body = {
      model: 'm', system: '', messages: [], max_tokens: 100,
      tools: [{ name: 'Read', description: '读文件', input_schema: { type: 'object' } }],
    };
    const req = normalizeAnthropicRequest(body, 0, 'r3');
    expect(req.tools).toEqual([{ name: 'Read', description: '读文件', inputSchema: { type: 'object' } }]);
  });
});

describe('normalizeAnthropicResponse', () => {
  it('归一响应的 content 和 usage（snake_case 转驼峰）', () => {
    const body = {
      id: 'msg_123', model: 'claude-sonnet-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: '答案' }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 },
    };
    const res = normalizeAnthropicResponse(body);
    expect(res.stopReason).toBe('end_turn');
    expect(res.content).toEqual([{ type: 'text', text: '答案' }]);
    expect(res.usage).toEqual({
      inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheCreationTokens: 10,
      model: 'claude-sonnet-5', messageId: 'msg_123',
    });
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/model/normalizer.test.ts`
预期：FAIL，报错 "Cannot find module '../../src/main/model/normalizer'"

- [ ] **步骤 3：编写实现**

```typescript
// src/main/model/normalizer.ts
import { ApiRequest, ApiResponse, ContentBlock, Message, ToolDef } from './types';

type RawBlock = Record<string, any>;

export function normalizeContent(content: unknown): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content)) {
    return content.map(normalizeBlock).filter((b): b is ContentBlock => b !== null);
  }
  return [];
}

function normalizeBlock(block: RawBlock | null | undefined): ContentBlock | null {
  if (!block || typeof block !== 'object') return null;
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text ?? '' };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        content: typeof block.content === 'string' ? block.content : normalizeContent(block.content),
        isError: block.is_error,
      };
    case 'image':
      return { type: 'image', source: block.source };
    case 'thinking':
      return { type: 'thinking', thinking: block.thinking ?? '', signature: block.signature };
    default:
      return null;
  }
}

function normalizeSystem(system: unknown): ContentBlock[] {
  if (typeof system === 'string') return [{ type: 'text', text: system }];
  return normalizeContent(system);
}

function normalizeMessages(messages: unknown): Message[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m: RawBlock) => ({
    role: m.role,
    content: normalizeContent(m.content),
  }));
}

function normalizeParams(body: RawBlock): { maxTokens: number; temperature?: number; topP?: number } {
  return {
    maxTokens: body.max_tokens ?? 0,
    temperature: body.temperature,
    topP: body.top_p,
  };
}

function normalizeTools(tools: unknown): ToolDef[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  return tools.map((t: RawBlock) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.input_schema ?? {},
  }));
}

export function normalizeAnthropicRequest(body: RawBlock, timestamp: number, id: string): ApiRequest {
  return {
    id,
    apiRequestId: body.id,
    timestamp,
    model: body.model ?? '',
    system: normalizeSystem(body.system),
    messages: normalizeMessages(body.messages),
    tools: normalizeTools(body.tools),
    params: normalizeParams(body),
    metadata: body.metadata,
  };
}

export function normalizeAnthropicResponse(body: RawBlock): ApiResponse {
  const usage = body.usage ?? {};
  return {
    content: normalizeContent(body.content),
    stopReason: body.stop_reason ?? '',
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      model: body.model,
      messageId: body.id,
    },
  };
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/model/normalizer.test.ts`
预期：PASS（所有用例通过）

- [ ] **步骤 5：Commit**

```bash
git add src/main/model/normalizer.ts tests/model/normalizer.test.ts
git commit -m "feat(model): add Anthropic normalizer with snake_case->camelCase"
```

---

## 任务 4：Claude Code JSONL 扫描器（TDD）

递归扫描 `~/.claude/projects/**/*.jsonl`，跳过 agent- 子代理会话，每文件读头尾几行提取元数据。借鉴 cc-switch `session_manager/providers/claude.rs`。

**文件：**
- 创建：`src/main/adapters/claude-log.ts`（scan + meta 部分）
- 测试：`tests/adapters/claude-log.test.ts`
- 创建：`tests/fixtures/simple-session.jsonl`

- [ ] **步骤 1：创建测试夹具**

```
// tests/fixtures/simple-session.jsonl
{"sessionId":"sess-1","cwd":"/tmp/project","timestamp":"2026-08-01T10:00:00Z"}
{"type":"user","message":{"role":"user","content":"帮我修 bug"},"sessionId":"sess-1","timestamp":"2026-08-01T10:00:01Z"}
{"type":"assistant","message":{"role":"assistant","content":"我来看看"},"sessionId":"sess-1","timestamp":"2026-08-01T10:00:02Z"}
{"type":"assistant","message":{"role":"assistant","content":"找到问题了"},"sessionId":"sess-1","timestamp":"2026-08-01T10:00:03Z"}
```

- [ ] **步骤 2：编写失败的测试**

```typescript
// tests/adapters/claude-log.test.ts
import { describe, it, expect } from 'vitest';
import { scanClaudeSessions, parseSessionMeta } from '../../src/main/adapters/claude-log';
import { resolve } from 'path';

const fixturesDir = resolve(__dirname, '../fixtures');

describe('parseSessionMeta', () => {
  it('从头尾行提取 sessionId、cwd、首条用户消息当标题', () => {
    const meta = parseSessionMeta(resolve(fixturesDir, 'simple-session.jsonl'));
    expect(meta).not.toBeNull();
    expect(meta!.sessionId).toBe('sess-1');
    expect(meta!.projectDir).toBe('/tmp/project');
    expect(meta!.title).toBe('帮我修 bug');
    expect(meta!.createdAt).toBe(1722506400000);
  });

  it('无用户消息时回退到目录名作标题', () => {
    const meta = parseSessionMeta(resolve(fixturesDir, 'no-user-session.jsonl'));
    // 夹具见步骤 4 补充
    expect(meta!.title).toBe('project');
  });
});

describe('scanClaudeSessions', () => {
  it('递归收集 .jsonl，跳过 agent- 开头的会话', () => {
    const sessions = scanClaudeSessions(fixturesDir);
    const ids = sessions.map((s) => s.sessionId);
    expect(ids).toContain('sess-1');
    // agent-session.jsonl 应被跳过
    expect(ids).not.toContain('agent-sess');
  });
});
```

- [ ] **步骤 3：运行测试验证失败**

运行：`npx vitest run tests/adapters/claude-log.test.ts`
预期：FAIL，报错模块不存在

- [ ] **步骤 4：创建补充夹具**

```
// tests/fixtures/no-user-session.jsonl
{"sessionId":"sess-2","cwd":"/tmp/project","timestamp":"2026-08-01T10:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":"你好"},"sessionId":"sess-2","timestamp":"2026-08-01T10:00:01Z"}
```

```
// tests/fixtures/agent-session.jsonl
{"sessionId":"agent-sess","cwd":"/tmp","timestamp":"2026-08-01T10:00:00Z"}
{"type":"user","message":{"role":"user","content":"agent"},"sessionId":"agent-sess","timestamp":"2026-08-01T10:00:01Z"}
```

- [ ] **步骤 5：编写实现（扫描 + 元数据部分）**

```typescript
// src/main/adapters/claude-log.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { Session, emptyUsage } from '../model/types';
import { normalizeContent } from '../model/normalizer';

const TITLE_MAX_CHARS = 80;
const HEAD_LINES = 10;
const TAIL_LINES = 30;

export interface SessionMeta {
  sessionId: string;
  title?: string;
  projectDir?: string;
  createdAt?: number;
  lastActiveAt?: number;
  sourcePath: string;
}

export function scanClaudeSessions(rootDir: string): SessionMeta[] {
  if (!existsDir(rootDir)) return [];
  const files: string[] = [];
  collectJsonlFiles(rootDir, files);
  const sessions: SessionMeta[] = [];
  for (const path of files) {
    if (isAgentSession(path)) continue;
    const meta = parseSessionMeta(path);
    if (meta) sessions.push(meta);
  }
  return sessions;
}

function existsDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function collectJsonlFiles(dir: string, out: string[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      collectJsonlFiles(full, out);
    } else if (name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
}

function isAgentSession(path: string): boolean {
  return basename(path).startsWith('agent-');
}

function readHeadTailLines(path: string, head: number, tail: number): { head: string[]; tail: string[] } {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return {
    head: lines.slice(0, head),
    tail: lines.slice(-tail),
  };
}

function parseTimestampToMs(ts: unknown): number | undefined {
  if (typeof ts !== 'string') return undefined;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? undefined : ms;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '...';
}

export function parseSessionMeta(path: string): SessionMeta | null {
  let head: string[], tail: string[];
  try { ({ head, tail } = readHeadTailLines(path, HEAD_LINES, TAIL_LINES)); }
  catch { return null; }

  let sessionId: string | undefined;
  let projectDir: string | undefined;
  let createdAt: number | undefined;
  let firstUserMessage: string | undefined;

  for (const line of head) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (sessionId === undefined && typeof obj.sessionId === 'string') sessionId = obj.sessionId;
    if (projectDir === undefined && typeof obj.cwd === 'string') projectDir = obj.cwd;
    if (createdAt === undefined) createdAt = parseTimestampToMs(obj.timestamp);
    if (firstUserMessage === undefined) {
      const isUser = obj.type === 'user' || obj.message?.role === 'user';
      if (isUser) {
        const text = extractText(obj.message?.content);
        const trimmed = text.trim();
        if (trimmed && !trimmed.includes('<local-command-caveat>') && !trimmed.startsWith('<command-name>')) {
          firstUserMessage = trimmed;
        }
      }
    }
    if (sessionId && projectDir && createdAt && firstUserMessage) break;
  }

  let lastActiveAt: number | undefined;
  for (const line of [...tail].reverse()) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (lastActiveAt === undefined) lastActiveAt = parseTimestampToMs(obj.timestamp);
    if (lastActiveAt !== undefined) break;
  }

  if (!sessionId) sessionId = basename(path).replace(/\.jsonl$/, '');
  if (!sessionId) return null;

  const title = firstUserMessage
    ? truncate(firstUserMessage, TITLE_MAX_CHARS)
    : projectDir ? basename(projectDir) : undefined;

  return { sessionId, title, projectDir, createdAt, lastActiveAt, sourcePath: path };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => b?.type === 'text' ? b.text : '')
      .join('');
  }
  return '';
}
```

- [ ] **步骤 6：运行测试验证通过**

运行：`npx vitest run tests/adapters/claude-log.test.ts`
预期：PASS

- [ ] **步骤 7：Commit**

```bash
git add src/main/adapters/claude-log.ts tests/adapters/claude-log.test.ts tests/fixtures/
git commit -m "feat(adapters): scan Claude Code JSONL sessions and parse metadata"
```

---

## 任务 5：Claude Code 会话全量解析 + 请求边界重建（TDD）

把整个 JSONL 解析成 Session，把对话流重建为 ApiRequest 序列（每个 assistant 消息 = 一次请求的响应）。tool_result 包在 user 消息里需重分类为 tool 角色。

**文件：**
- 修改：`src/main/adapters/claude-log.ts`（加 loadClaudeSession）
- 修改：`tests/adapters/claude-log.test.ts`（加测试）
- 创建：`tests/fixtures/tool-use-session.jsonl`

- [ ] **步骤 1：创建工具调用夹具**

```
// tests/fixtures/tool-use-session.jsonl
{"sessionId":"tu-sess","cwd":"/tmp/p","timestamp":"2026-08-01T10:00:00Z"}
{"type":"user","message":{"role":"user","content":"读文件"},"sessionId":"tu-sess","timestamp":"2026-08-01T10:00:01Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"好的"},{"type":"tool_use","id":"tu_1","name":"Read","input":{"file_path":"a.ts"}}]},"sessionId":"tu-sess","timestamp":"2026-08-01T10:00:02Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"文件内容"}]},"sessionId":"tu-sess","timestamp":"2026-08-01T10:00:03Z"}
{"type":"assistant","message":{"role":"assistant","content":"这是文件内容"},"sessionId":"tu-sess","timestamp":"2026-08-01T10:00:04Z"}
```

- [ ] **步骤 2：编写失败的测试**

追加到 `tests/adapters/claude-log.test.ts`：

```typescript
import { loadClaudeSession } from '../../src/main/adapters/claude-log';

describe('loadClaudeSession', () => {
  it('把 assistant 消息重建为请求的响应，messages 累积', () => {
    const session = loadClaudeSession(resolve(fixturesDir, 'simple-session.jsonl'));
    expect(session.client).toBe('claude-code');
    expect(session.source).toBe('claude-code-log');
    // 2 个 assistant 消息 -> 2 个 ApiRequest
    expect(session.requests).toHaveLength(2);

    // 第 1 个请求：messages = [user "帮我修 bug"]，response = "我来看看"
    expect(session.requests[0].messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '帮我修 bug' }] },
    ]);
    expect(session.requests[0].response?.content).toEqual([{ type: 'text', text: '我来看看' }]);

    // 第 2 个请求：messages 累积了第 1 个 assistant，response = "找到问题了"
    expect(session.requests[1].messages).toHaveLength(2);
    expect(session.requests[1].messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: '我来看看' }] });
    expect(session.requests[1].response?.content).toEqual([{ type: 'text', text: '找到问题了' }]);
  });

  it('tool_result 在 user 消息里被重分类为 tool 角色', () => {
    const session = loadClaudeSession(resolve(fixturesDir, 'tool-use-session.jsonl'));
    expect(session.requests).toHaveLength(2);
    // 第 1 个请求的 messages = [user "读文件"]
    // 第 2 个请求的 messages = [user, assistant(带 tool_use), tool(tool_result)]
    const req2 = session.requests[1];
    expect(req2.messages[2].role).toBe('tool');
    expect(req2.messages[2].content[0]).toMatchObject({ type: 'tool_result', toolUseId: 'tu_1' });
  });

  it('日志不含 system/tools/params，这些字段为空或默认', () => {
    const session = loadClaudeSession(resolve(fixturesDir, 'simple-session.jsonl'));
    expect(session.requests[0].system).toEqual([]);
    expect(session.requests[0].tools).toBeUndefined();
    expect(session.requests[0].model).toBe('');
  });
});
```

- [ ] **步骤 3：运行测试验证失败**

运行：`npx vitest run tests/adapters/claude-log.test.ts`
预期：FAIL，报错 loadClaudeSession 未导出

- [ ] **步骤 4：实现 loadClaudeSession**

追加到 `src/main/adapters/claude-log.ts`：

```typescript
import { Session, ApiRequest, Message } from '../model/types';

interface JsonlLine {
  type?: string;
  message?: { role?: string; content?: unknown };
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  isMeta?: boolean;
  customTitle?: string;
}

interface ConvoMessage {
  role: 'user' | 'assistant' | 'tool';
  content: import('../model/types').ContentBlock[];
  ts?: number;
}

export function loadClaudeSession(path: string): Session {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  const convo: ConvoMessage[] = [];
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let firstTs: number | undefined;
  let lastTs: number | undefined;

  for (const line of lines) {
    let obj: JsonlLine;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.isMeta) continue;
    if (obj.sessionId) sessionId = obj.sessionId;
    if (obj.cwd) cwd = obj.cwd;
    const ts = parseTimestampToMs(obj.timestamp);
    if (ts !== undefined) {
      if (firstTs === undefined) firstTs = ts;
      lastTs = ts;
    }
    const msg = obj.message;
    if (!msg || !msg.role) continue;
    const content = normalizeContent(msg.content);
    if (content.length === 0) continue;
    let role = msg.role as ConvoMessage['role'];
    if (role === 'user' && content.every((b) => b.type === 'tool_result')) {
      role = 'tool';
    }
    convo.push({ role, content, ts });
  }

  const requests: ApiRequest[] = [];
  let pending: Message[] = [];
  for (const m of convo) {
    if (m.role === 'assistant') {
      const reqId = `${sessionId ?? 'sess'}-${requests.length}`;
      requests.push({
        id: reqId,
        timestamp: m.ts ?? lastTs ?? Date.now(),
        model: '',
        system: [],
        messages: pending.map((p) => ({ ...p })),
        params: { maxTokens: 0 },
        response: { content: m.content, stopReason: '', usage: emptyUsage() },
      });
      pending = [...pending, { role: 'assistant', content: m.content }];
    } else {
      pending.push({ role: m.role, content: m.content });
    }
  }

  const meta = parseSessionMeta(path);
  return {
    id: sessionId ?? basename(path),
    source: 'claude-code-log',
    client: 'claude-code',
    startedAt: firstTs ?? Date.now(),
    endedAt: lastTs,
    title: meta?.title,
    projectDir: cwd ?? meta?.projectDir,
    requests,
  };
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`npx vitest run tests/adapters/claude-log.test.ts`
预期：PASS

- [ ] **步骤 6：运行全部测试**

运行：`npm test`
预期：全部 PASS

- [ ] **步骤 7：Commit**

```bash
git add src/main/adapters/claude-log.ts tests/adapters/claude-log.test.ts tests/fixtures/tool-use-session.jsonl
git commit -m "feat(adapters): reconstruct ApiRequests from Claude Code JSONL with tool_result reclassification"
```

---

## 任务 6：会话存储（TDD）

把捕获/解析的会话存成 JSON 文件。v1 主要给代理捕获用（日志扫描按需读取原文件），但接口统一。

**文件：**
- 创建：`src/main/store/session-store.ts`
- 测试：`tests/store/session-store.test.ts`

- [ ] **步骤 1：编写失败的测试**

```typescript
// tests/store/session-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../../src/main/store/session-store';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Session } from '../../src/main/model/types';

const tmpDir = resolve(__dirname, '../.tmp-store-test');

describe('SessionStore', () => {
  beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('saveSession 写一个 JSON 文件，loadSession 读回来', () => {
    const store = new SessionStore(tmpDir);
    const session: Session = {
      id: 's1', source: 'proxy-live', client: 'claude-code',
      startedAt: 1000, title: 'test', requests: [],
    };
    const path = store.saveSession(session);
    expect(existsSync(path)).toBe(true);

    const loaded = store.loadSession('s1');
    expect(loaded).toEqual(session);
  });

  it('listSessions 返回所有已存会话的 id', () => {
    const store = new SessionStore(tmpDir);
    store.saveSession({ id: 'a', source: 'proxy-live', client: 'claude-code', startedAt: 1, requests: [] });
    store.saveSession({ id: 'b', source: 'proxy-live', client: 'claude-code', startedAt: 2, requests: [] });
    expect(store.listSessions().sort()).toEqual(['a', 'b']);
  });

  it('deleteSession 删除文件', () => {
    const store = new SessionStore(tmpDir);
    store.saveSession({ id: 'x', source: 'proxy-live', client: 'claude-code', startedAt: 1, requests: [] });
    expect(store.deleteSession('x')).toBe(true);
    expect(store.loadSession('x')).toBeNull();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run tests/store/session-store.test.ts`
预期：FAIL，模块不存在

- [ ] **步骤 3：编写实现**

```typescript
// src/main/store/session-store.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Session } from '../model/types';

export class SessionStore {
  constructor(private dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  saveSession(session: Session): string {
    const path = this.path(session.id);
    writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8');
    return path;
  }

  loadSession(id: string): Session | null {
    const path = this.path(id);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as Session;
  }

  listSessions(): string[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  }

  deleteSession(id: string): boolean {
    const path = this.path(id);
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run tests/store/session-store.test.ts`
预期：PASS

- [ ] **步骤 5：把 .tmp 加进 .gitignore**

创建 `.gitignore`：
```
node_modules
out
dist
tests/.tmp-*
.superpowers
```

- [ ] **步骤 6：Commit**

```bash
git add src/main/store/session-store.ts tests/store/session-store.test.ts .gitignore
git commit -m "feat(store): JSON-backed session persistence"
```

---

## 任务 7：Electron 主进程 + IPC

创建主进程入口、窗口、IPC handlers（列出会话、加载会话）。检测 `~/.claude/projects` 位置。

**文件：**
- 创建：`src/main/index.ts`、`src/main/ipc.ts`
- 创建：`src/preload/index.ts`

- [ ] **步骤 1：创建 IPC handlers**

```typescript
// src/main/ipc.ts
import { ipcMain, dialog } from 'electron';
import { scanClaudeSessions, loadClaudeSession, SessionMeta } from './adapters/claude-log';
import { join } from 'path';
import { homedir } from 'os';
import { Session } from './model/types';

function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

export function registerIpc(): void {
  ipcMain.handle('sessions:list', async (): Promise<SessionMeta[]> => {
    return scanClaudeSessions(claudeProjectsDir());
  });

  ipcMain.handle('sessions:load', async (_e, sourcePath: string): Promise<Session | null> => {
    try {
      return loadClaudeSession(sourcePath);
    } catch {
      return null;
    }
  });
}
```

- [ ] **步骤 2：创建主进程入口**

```typescript
// src/main/index.ts
import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

注意：`index.ts` 顶部需 `import { join } from 'path';`。

- [ ] **步骤 3：创建 preload**

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  loadSession: (sourcePath: string) => ipcRenderer.invoke('sessions:load', sourcePath),
});
```

- [ ] **步骤 4：验证编译**

运行：`npx tsc --noEmit`
预期：无错误

- [ ] **步骤 5：Commit**

```bash
git add src/main/index.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(main): wire up window, IPC handlers for session list/load"
```

---

## 任务 8：渲染进程状态 + 类型声明

zustand store 管理当前会话列表、选中会话、当前视图、选中请求。声明全局 `api` 类型。

**文件：**
- 创建：`src/renderer/store.ts`、`src/renderer/global.d.ts`

- [ ] **步骤 1：创建全局类型声明**

```typescript
// src/renderer/global.d.ts
import { SessionMeta } from '../main/adapters/claude-log';
import { Session, ApiRequest } from '../main/model/types';

export interface ApiBinding {
  listSessions: () => Promise<SessionMeta[]>;
  loadSession: (sourcePath: string) => Promise<Session | null>;
}

declare global {
  interface Window {
    api: ApiBinding;
  }
}
```

- [ ] **步骤 2：创建 zustand store**

```typescript
// src/renderer/store.ts
import { create } from 'zustand';
import { Session, ApiRequest } from '../main/model/types';
import { SessionMeta } from '../main/adapters/claude-log';

export type ViewKind = 'json-tree' | 'chat-flow';

interface State {
  sessions: SessionMeta[];
  currentSession: Session | null;
  currentRequest: ApiRequest | null;
  currentView: ViewKind;
  loading: boolean;
  setSessions: (s: SessionMeta[]) => void;
  setCurrentSession: (s: Session | null) => void;
  setCurrentRequest: (r: ApiRequest | null) => void;
  setCurrentView: (v: ViewKind) => void;
  setLoading: (b: boolean) => void;
  refreshSessions: () => Promise<void>;
  openSession: (sourcePath: string) => Promise<void>;
}

export const useStore = create<State>((set, get) => ({
  sessions: [],
  currentSession: null,
  currentRequest: null,
  currentView: 'chat-flow',
  loading: false,
  setSessions: (s) => set({ sessions: s }),
  setCurrentSession: (s) => {
    set({ currentSession: s, currentRequest: s?.requests[0] ?? null });
  },
  setCurrentRequest: (r) => set({ currentRequest: r }),
  setCurrentView: (v) => set({ currentView: v }),
  setLoading: (b) => set({ loading: b }),
  refreshSessions: async () => {
    const sessions = await window.api.listSessions();
    set({ sessions });
  },
  openSession: async (sourcePath) => {
    set({ loading: true });
    const session = await window.api.loadSession(sourcePath);
    get().setCurrentSession(session);
    set({ loading: false });
  },
}));
```

- [ ] **步骤 3：验证编译**

运行：`npx tsc --noEmit`
预期：无错误

- [ ] **步骤 4：Commit**

```bash
git add src/renderer/store.ts src/renderer/global.d.ts
git commit -m "feat(renderer): zustand store and global api type"
```

---

## 任务 9：侧栏会话列表

显示扫描到的会话，点击加载。启动时自动刷新。

**文件：**
- 创建：`src/renderer/components/Sidebar.tsx`

- [ ] **步骤 1：实现侧栏**

```tsx
// src/renderer/components/Sidebar.tsx
import { useEffect } from 'react';
import { useStore } from '../store';

export function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const refreshSessions = useStore((s) => s.refreshSessions);
  const openSession = useStore((s) => s.openSession);
  const currentSession = useStore((s) => s.currentSession);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  return (
    <div style={{ width: 240, borderRight: '1px solid #333', padding: 8, overflowY: 'auto' }}>
      <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
        Claude Code 会话
      </div>
      {sessions.length === 0 && (
        <div style={{ fontSize: 12, opacity: 0.5 }}>未找到会话</div>
      )}
      {sessions.map((s) => (
        <button
          key={s.sourcePath}
          onClick={() => openSession(s.sourcePath)}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: 6, marginBottom: 4, borderRadius: 4, cursor: 'pointer',
            background: currentSession?.id === s.sessionId ? 'rgba(155,140,255,0.2)' : 'transparent',
            border: 'none', color: 'inherit',
          }}
        >
          <div style={{ fontSize: 12 }}>{s.title ?? s.sessionId}</div>
          <div style={{ fontSize: 10, opacity: 0.5 }}>{s.projectDir ?? ''}</div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **步骤 2：验证编译**

运行：`npx tsc --noEmit`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add src/renderer/components/Sidebar.tsx
git commit -m "feat(renderer): session list sidebar with auto-refresh"
```

---

## 任务 10：视图切换器 + 请求选择器

顶部栏：切换两个视图、在会话的多个请求间切换。

**文件：**
- 创建：`src/renderer/components/ViewSwitcher.tsx`

- [ ] **步骤 1：实现切换器**

```tsx
// src/renderer/components/ViewSwitcher.tsx
import { useStore, ViewKind } from '../store';

export function ViewSwitcher() {
  const currentView = useStore((s) => s.currentView);
  const setCurrentView = useStore((s) => s.setCurrentView);
  const currentSession = useStore((s) => s.currentSession);
  const currentRequest = useStore((s) => s.currentRequest);
  const setCurrentRequest = useStore((s) => s.setCurrentRequest);

  const views: { kind: ViewKind; label: string }[] = [
    { kind: 'chat-flow', label: '对话流' },
    { kind: 'json-tree', label: 'JSON 树' },
  ];

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid #333' }}>
      {views.map((v) => (
        <button
          key={v.kind}
          onClick={() => setCurrentView(v.kind)}
          style={{
            padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
            background: currentView === v.kind ? 'rgba(155,140,255,0.3)' : 'transparent',
            border: '1px solid #444', color: 'inherit',
          }}
        >
          {v.label}
        </button>
      ))}
      {currentSession && (
        <select
          value={currentRequest?.id ?? ''}
          onChange={(e) => {
            const req = currentSession.requests.find((r) => r.id === e.target.value);
            setCurrentRequest(req ?? null);
          }}
          style={{ marginLeft: 'auto', padding: 4, background: '#222', color: 'inherit', border: '1px solid #444' }}
        >
          {currentSession.requests.map((r, i) => (
            <option key={r.id} value={r.id}>请求 #{i + 1}</option>
          ))}
        </select>
      )}
    </div>
  );
}
```

- [ ] **步骤 2：验证编译**

运行：`npx tsc --noEmit`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add src/renderer/components/ViewSwitcher.tsx
git commit -m "feat(renderer): view switcher and request selector"
```

---

## 任务 11：JSON 树视图

可折叠树，按字段类型配色，大块默认折叠。显示当前选中 ApiRequest 的结构。

**文件：**
- 创建：`src/renderer/views/JsonTreeView.tsx`

- [ ] **步骤 1：实现 JSON 树**

```tsx
// src/renderer/views/JsonTreeView.tsx
import { useState } from 'react';
import { useStore } from '../store';
import { ApiRequest } from '../../main/model/types';

function typeColor(type: string): string {
  switch (type) {
    case 'tool_use': return '#ffb74d';
    case 'tool_result': return '#81c784';
    case 'text': return '#90caf9';
    case 'thinking': return '#ce93d8';
    default: return '#ccc';
  }
}

interface NodeProps {
  label?: string;
  value: unknown;
  defaultOpen?: boolean;
  depth: number;
}

function JsonNode({ label, value, defaultOpen = true, depth }: NodeProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (value === null) {
    return <div style={{ paddingLeft: depth * 14 }}>{label && <span style={{ color: '#9b8cff' }}>{label}: </span>}<span style={{ opacity: 0.5 }}>null</span></div>;
  }
  if (typeof value === 'string') {
    return <div style={{ paddingLeft: depth * 14 }}>{label && <span style={{ color: '#9b8cff' }}>{label}: </span>}<span style={{ color: '#90caf9' }}>"{value.length > 80 ? value.slice(0, 80) + '…' : value}"</span></div>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <div style={{ paddingLeft: depth * 14 }}>{label && <span style={{ color: '#9b8cff' }}>{label}: </span>}<span style={{ color: '#ffb74d' }}>{String(value)}</span></div>;
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as object);

  const blockType = typeof value === 'object' && value !== null && 'type' in (value as any) ? (value as any).type : undefined;

  return (
    <div>
      <div
        style={{ paddingLeft: depth * 14, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ opacity: 0.6 }}>{open ? '▼' : '▶'}</span>
        {label && <span style={{ color: '#9b8cff' }}> {label}</span>}
        {blockType && <span style={{ color: typeColor(blockType), marginLeft: 6 }}>[{blockType}]</span>}
        <span style={{ opacity: 0.4, marginLeft: 6 }}>{isArray ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </div>
      {open && entries.map(([k, v]) => (
        <JsonNode key={k} label={k} value={v} defaultOpen={depth < 1} depth={depth + 1} />
      ))}
    </div>
  );
}

export function JsonTreeView() {
  const req = useStore((s) => s.currentRequest);
  if (!req) {
    return <div style={{ padding: 24, opacity: 0.5 }}>选中一个会话和请求以查看 JSON 结构</div>;
  }
  const view: Partial<ApiRequest> = {
    model: req.model,
    system: req.system,
    messages: req.messages,
    tools: req.tools,
    params: req.params,
    response: req.response,
  };
  return (
    <div style={{ padding: 12, fontFamily: 'ui-monospace, monospace', fontSize: 12, overflow: 'auto', height: '100%' }}>
      <JsonNode value={view} defaultOpen={true} depth={0} />
    </div>
  );
}
```

- [ ] **步骤 2：验证编译**

运行：`npx tsc --noEmit`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add src/renderer/views/JsonTreeView.tsx
git commit -m "feat(views): collapsible JSON tree view with type coloring"
```

---

## 任务 12：透明对话流视图

聊天气泡，露出 system（折叠）、tool_use、tool_result（按 id 配对）。基于 system + messages 渲染。

**文件：**
- 创建：`src/renderer/views/ChatFlowView.tsx`

- [ ] **步骤 1：实现对话流视图**

```tsx
// src/renderer/views/ChatFlowView.tsx
import { useState } from 'react';
import { useStore } from '../store';
import { ContentBlock } from '../../main/model/types';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return <div style={{ whiteSpace: 'pre-wrap' }}>{block.text}</div>;
    case 'tool_use':
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(255,183,77,0.15)', borderRadius: 4, fontSize: 12 }}>
          <span>🔧 <strong>tool_use: {block.name}</strong></span>
          <pre style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 11, overflow: 'auto' }}>
            {JSON.stringify(block.input, null, 2)}
          </pre>
        </div>
      );
    case 'tool_result':
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(129,199,132,0.1)', borderLeft: '3px solid #81c784', borderRadius: '0 4px 4px 0', fontSize: 12 }}>
          <span style={{ color: '#81c784', fontWeight: 600 }}>📥 tool_result</span>
          <pre style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 11, overflow: 'auto' }}>
            {typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}
          </pre>
        </div>
      );
    case 'thinking':
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(206,147,216,0.1)', borderRadius: 4, fontSize: 12, opacity: 0.7 }}>
          💭 {block.thinking}
        </div>
      );
    default:
      return null;
  }
}

function Message({ role, blocks }: { role: string; blocks: ContentBlock[] }) {
  const colors: Record<string, { bg: string; label: string; icon: string }> = {
    user: { bg: 'rgba(144,202,250,0.1)', label: 'USER', icon: '👤' },
    assistant: { bg: 'rgba(155,140,255,0.1)', label: 'ASSISTANT', icon: '🤖' },
    tool: { bg: 'rgba(129,199,132,0.08)', label: 'TOOL', icon: '📥' },
    system: { bg: 'rgba(255,183,77,0.08)', label: 'SYSTEM', icon: '⚙️' },
  };
  const c = colors[role] ?? colors.user;
  const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const toks = estimateTokens(text);
  return (
    <div style={{ background: c.bg, padding: '6px 10px', marginBottom: 6, borderRadius: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>{c.icon} {c.label} · {toks} tok</div>
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </div>
  );
}

export function ChatFlowView() {
  const req = useStore((s) => s.currentRequest);
  const [systemOpen, setSystemOpen] = useState(false);

  if (!req) {
    return <div style={{ padding: 24, opacity: 0.5 }}>选中一个会话和请求以查看对话流</div>;
  }

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      {req.system.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <button
            onClick={() => setSystemOpen(!systemOpen)}
            style={{ padding: '4px 8px', background: 'rgba(255,183,77,0.08)', border: 'none', borderRadius: 4, cursor: 'pointer', color: 'inherit' }}
          >
            ⚙️ SYSTEM · {req.system.reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0)} 字 {systemOpen ? '▼' : '▶'}
          </button>
          {systemOpen && req.system.map((b, i) => <Block key={i} block={b} />)}
        </div>
      )}
      {req.messages.map((m, i) => (
        <Message key={i} role={m.role} blocks={m.content} />
      ))}
      {req.response && (
        <Message role="assistant" blocks={req.response.content} />
      )}
    </div>
  );
}
```

- [ ] **步骤 2：验证编译**

运行：`npx tsc --noEmit`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add src/renderer/views/ChatFlowView.tsx
git commit -m "feat(views): transparent chat flow showing system/tool_use/tool_result"
```

---

## 任务 13：组装根组件 + 端到端验证

把侧栏、切换器、视图组装起来，加基础样式，启动应用验证端到端。

**文件：**
- 创建：`src/renderer/main.tsx`、`src/renderer/App.tsx`、`src/renderer/styles.css`

- [ ] **步骤 1：创建样式**

```css
/* src/renderer/styles.css */
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, 'Segoe UI', sans-serif; background: #1e1e1e; color: #ddd; }
button { font-family: inherit; }
#root { height: 100vh; display: flex; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: #444; border-radius: 4px; }
```

- [ ] **步骤 2：创建 main.tsx**

```tsx
// src/renderer/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **步骤 3：创建 App.tsx**

```tsx
// src/renderer/App.tsx
import { Sidebar } from './components/Sidebar';
import { ViewSwitcher } from './components/ViewSwitcher';
import { JsonTreeView } from './views/JsonTreeView';
import { ChatFlowView } from './views/ChatFlowView';
import { useStore } from './store';

export function App() {
  const currentView = useStore((s) => s.currentView);
  const currentSession = useStore((s) => s.currentSession);

  return (
    <>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ViewSwitcher />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {!currentSession ? (
            <div style={{ padding: 24, opacity: 0.5 }}>从左侧选择一个会话开始</div>
          ) : currentView === 'json-tree' ? (
            <JsonTreeView />
          ) : (
            <ChatFlowView />
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **步骤 4：验证编译**

运行：`npx tsc --noEmit && npm run build`
预期：构建成功，无错误

- [ ] **步骤 5：运行全部测试**

运行：`npm test`
预期：全部 PASS

- [ ] **步骤 6：启动应用做端到端验证**

运行：`npm run dev`
预期：
- 应用窗口打开，深色主题
- 左侧列出 `~/.claude/projects/` 下的会话（若无会话显示"未找到会话"）
- 点击一个会话 -> 加载，右侧显示对话流
- 切换到 JSON 树 -> 显示请求结构
- 顶部下拉切换不同请求
- 退出应用无崩溃

- [ ] **步骤 7：Commit**

```bash
git add src/renderer/main.tsx src/renderer/App.tsx src/renderer/styles.css
git commit -m "feat(renderer): assemble app layout and verify end-to-end"
```

---

## 自检

**1. 规格覆盖度（MVP 范围）：**
- 统一数据模型 -> 任务 2 ✅
- Anthropic normalizer -> 任务 3 ✅
- Claude Code 日志自动扫描 -> 任务 4 ✅
- 请求边界重建 -> 任务 5 ✅
- 会话存储 -> 任务 6 ✅
- 主进程 + IPC -> 任务 7 ✅
- 前端状态 -> 任务 8 ✅
- 侧栏 -> 任务 9 ✅
- 视图切换 -> 任务 10 ✅
- JSON 树视图 -> 任务 11 ✅
- 透明对话流视图 -> 任务 12 ✅
- 组装验证 -> 任务 13 ✅
- 遗漏：无（MVP 范围内全覆盖）

**规格中不在 MVP 的部分**（实时代理、时间线、结构分解、桌面版、Codex）-> 计划 2，已在本计划开头声明。

**2. 占位符扫描：** 无 TODO/"待定"/"添加适当错误处理"。错误处理在 IPC 的 loadSession 用 try/catch 兜底返回 null（任务 7 已含）。

**3. 类型一致性：** `Session`/`ApiRequest`/`ContentBlock` 等类型在任务 2 定义，任务 3-12 使用一致。`SessionMeta` 在任务 4 定义，任务 7-8 引用一致。`ViewKind` 在任务 8 定义，任务 10-13 引用一致。`emptyUsage` 在任务 2 定义，任务 5 引用一致。

**4. 已知技术债：**
- `index.ts` 需 `import { join } from 'path'`（任务 7 步骤 2 已注明）
- Vitest 配置默认支持 TS，无需额外 config；若报错加 `vitest.config.ts`（`test: { environment: 'node' }`）

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-08-04-dialogue-viz-mvp.md`。两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

选哪种方式？
