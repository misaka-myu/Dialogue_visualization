// src/renderer/components/CodeViewer.tsx
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { markdown } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';

const EXT_LANG: Record<string, string> = {
  json: 'json',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  rs: 'rust',
  c: 'cpp', h: 'cpp', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  md: 'markdown', markdown: 'markdown',
};

export function languageFromPath(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const m = filePath.match(/\.([a-zA-Z0-9]+)$/);
  if (!m) return undefined;
  return EXT_LANG[m[1].toLowerCase()];
}

function langExtension(lang?: string): Extension[] {
  switch (lang) {
    case 'json': return [json()];
    case 'javascript': return [javascript({ jsx: true })];
    case 'typescript': return [javascript({ jsx: true, typescript: true })];
    case 'python': return [python()];
    case 'rust': return [rust()];
    case 'cpp': return [cpp()];
    case 'markdown': return [markdown()];
    default: return [];
  }
}

/** Try to detect if text is JSON; return 'json' if so. */
function detectJson(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (!(t.startsWith('{') || t.startsWith('['))) return undefined;
  try { JSON.parse(t); return 'json'; } catch { return undefined; }
}

export function CodeViewer({ value, language }: { value: string; language?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const lang = language ?? detectJson(value);
    const state = EditorState.create({
      doc: value,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        oneDark,
        ...langExtension(lang),
        EditorView.theme({
          '&': { backgroundColor: 'transparent', fontSize: '12px', maxHeight: '50vh' },
          '.cm-scroller': { fontFamily: 'ui-monospace, monospace', overflow: 'auto' },
          '.cm-gutters': { backgroundColor: 'rgba(0,0,0,0.2)', border: 'none' },
        }),
      ],
    });
    const view = new EditorView({ state, parent: ref.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [value, language]);

  return <div ref={ref} style={{ maxHeight: '50vh', overflow: 'auto', border: '1px solid #333', borderRadius: 4 }} />;
}
