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
  /** Number of conversation messages preceding this request's assistant response.
   *  The input messages for this request = session.conversation.slice(0, messageCount). */
  messageCount: number;
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
  /** Flat linear conversation array — each message stored exactly once.
   *  A request's input messages = conversation.slice(0, request.messageCount). */
  conversation: Message[];
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
