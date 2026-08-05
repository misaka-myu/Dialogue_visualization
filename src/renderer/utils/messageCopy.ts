// src/renderer/utils/messageCopy.ts
import type { ContentBlock, Message } from '../../main/model/types';
import { useStore } from '../store';

/** Concatenate the text-bearing parts of a message's content blocks,
 *  separated by blank lines, suitable for pasting into chat / docs. */
export function toPlainText(content: ContentBlock[]): string {
  return content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'thinking') return b.thinking;
      if (b.type === 'tool_use') return `[${b.name}] ${JSON.stringify(b.input)}`;
      if (b.type === 'tool_result') {
        return typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2);
      }
      return '';
    })
    .filter((s) => s.length > 0)
    .join('\n\n');
}

/** Serialize a message as pretty JSON for clipboard. The shape mirrors
 *  what the renderer shows, minus view-only metadata. */
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

/** Write to clipboard and surface the result via a transient toast (not a
 *  blocking dialog). On failure, the toast explains why. */
export async function copyToClipboard(text: string, kind: '文本' | 'JSON'): Promise<boolean> {
  try {
    if (!navigator.clipboard) {
      useStore.getState().setToast(`无法访问剪贴板 API — 复制${kind}失败。`);
      return false;
    }
    await navigator.clipboard.writeText(text);
    useStore.getState().setToast(`已复制${kind}到剪贴板。`);
    return true;
  } catch (err) {
    console.error(`[copy] ${kind} copy failed:`, err);
    useStore.getState().setToast(`复制${kind}失败，请检查浏览器/系统权限。`);
    return false;
  }
}