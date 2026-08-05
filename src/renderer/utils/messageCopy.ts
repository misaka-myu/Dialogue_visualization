// src/renderer/utils/messageCopy.ts
import type { Message } from '../../main/model/types';
import { extractMessageTextForDisplay } from './messageContent';
import { useStore } from '../store';

/** Pretty-print a message as JSON for clipboard. Mirrors the renderer's
 *  shape, minus view-only metadata. */
export function toCopyJSON(message: Message): string {
  return JSON.stringify(
    {
      role: message.role,
      content: message.content,
      meta: message.meta ?? null,
    },
    null,
    2,
  );
}

/** Classify a clipboard error into a user-actionable hint. Returns a short
 *  Chinese sentence describing what likely went wrong. */
function classifyClipboardError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  const msg = String((err as { message?: string } | null)?.message ?? err ?? '');
  if (name === 'NotAllowedError') return '复制失败 — 浏览器拒绝了剪贴板写入权限。';
  if (msg.includes('Document is not focused') || name === 'SecurityError') {
    return '复制失败 — 窗口未获焦点，请先点一下应用再试。';
  }
  if (msg.toLowerCase().includes('busy') || msg.includes('Resource deadlock')) {
    return '复制失败 — 剪贴板被其他应用占用，请稍后再试。';
  }
  return '复制失败，请检查浏览器/系统权限。';
}

/** Write to clipboard and surface the result via a transient toast (not a
 *  blocking dialog). Distinguishes common failure modes so the user knows
 *  whether to focus the window, retry, or check permissions. */
export async function copyToClipboard(text: string, kind: '文本' | 'JSON'): Promise<boolean> {
  const toast = (msg: string) => useStore.getState().setToast(msg);
  try {
    if (!navigator.clipboard) {
      toast(`无法访问剪贴板 API — 复制${kind}失败。`);
      return false;
    }
    await navigator.clipboard.writeText(text);
    toast(`已复制${kind}到剪贴板。`);
    return true;
  } catch (err) {
    console.error(`[copy] ${kind} copy failed:`, err);
    toast(`${classifyClipboardError(err)}（${kind}）`);
    return false;
  }
}

/** Convenience: copy a message as plain text. */
export async function copyMessageText(message: Message): Promise<boolean> {
  return copyToClipboard(extractMessageTextForDisplay(message.content), '文本');
}

/** Convenience: copy a message as JSON. */
export async function copyMessageJson(message: Message): Promise<boolean> {
  return copyToClipboard(toCopyJSON(message), 'JSON');
}