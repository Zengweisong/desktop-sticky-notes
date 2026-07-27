import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, ensureSyntaxTree, HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { Decoration, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightSpecialChars, keymap, placeholder, ViewPlugin, WidgetType, type DecorationSet } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

interface Props {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onCompositionChange: (composing: boolean) => void;
}

const editable = new Compartment();

export function MarkdownEditor({ value, disabled = false, onChange, onCancel, onCompositionChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacksRef = useRef({ onChange, onCancel, onCompositionChange });
  callbacksRef.current = { onChange, onCancel, onCompositionChange };

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: editorExtensions(disabled, callbacksRef)
      })
    });
    viewRef.current = view;
    return () => { viewRef.current = null; view.destroy(); };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!disabled)) });
  }, [disabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={hostRef} className="markdown-live-editor" />;
}

function editorExtensions(disabled: boolean, callbacksRef: React.MutableRefObject<{
  onChange: (value: string) => void;
  onCancel: () => void;
  onCompositionChange: (composing: boolean) => void;
}>): Extension[] {
  return [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    markdown({ extensions: GFM }),
    EditorView.lineWrapping,
    editable.of(EditorView.editable.of(!disabled)),
    EditorView.contentAttributes.of({
      "aria-label": "详细备注",
      "aria-multiline": "true",
      spellcheck: "true"
    }),
    placeholder("用 Markdown 记录详情，输入后会实时排版…"),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    syntaxHighlighting(HighlightStyle.define([
      { tag: tags.heading, color: "var(--text)", fontWeight: "650" },
      { tag: tags.strong, color: "var(--text)", fontWeight: "700" },
      { tag: tags.emphasis, fontStyle: "italic" },
      { tag: [tags.monospace, tags.string], color: "var(--accent-strong)" },
      { tag: tags.link, color: "var(--accent-strong)", textDecoration: "underline" },
      { tag: tags.meta, color: "var(--faint)" }
    ])),
    livePreview,
    keymap.of([
      { key: "Mod-b", run: (view) => wrapSelection(view, "**") },
      { key: "Mod-i", run: (view) => wrapSelection(view, "*") },
      { key: "Mod-k", run: insertLink },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) callbacksRef.current.onChange(update.state.doc.toString());
    }),
    Prec.highest(EditorView.domEventHandlers({
      keydown(event) {
        event.stopPropagation();
        if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          callbacksRef.current.onCancel();
          return true;
        }
        return false;
      },
      compositionstart() {
        callbacksRef.current.onCompositionChange(true);
        return false;
      },
      compositionend() {
        callbacksRef.current.onCompositionChange(false);
        return false;
      }
    })),
    EditorView.theme({
      "&": { backgroundColor: "transparent", color: "var(--text)" },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { fontFamily: "inherit" },
      ".cm-content": { caretColor: "var(--accent-strong)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent-strong)" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--accent-soft)" },
      ".cm-activeLine": { backgroundColor: "rgba(var(--card-rgb), .18)" },
      ".cm-panels": { backgroundColor: "rgb(var(--panel-rgb))", color: "var(--text)" },
      ".cm-tooltip": { backgroundColor: "rgb(var(--panel-rgb))", color: "var(--text)", borderColor: "var(--border)" }
    }, { dark: true })
  ];
}

const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildLivePreview(view);
  }

  update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean; viewportChanged: boolean }) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildLivePreview(update.view);
    }
  }
}, { decorations: (value) => value.decorations });

function buildLivePreview(view: EditorView) {
  const ranges: Array<ReturnType<Decoration["range"]>> = [];
  const activeLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    let line = view.state.doc.lineAt(range.from);
    const last = view.state.doc.lineAt(range.to).number;
    while (line.number <= last) {
      activeLines.add(line.number);
      if (line.number === last) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  const inactive = (from: number) => !activeLines.has(view.state.doc.lineAt(from).number);
  const decoratedLines = new Set<string>();
  const addLine = (from: number, className: string) => {
    const line = view.state.doc.lineAt(from);
    const key = `${line.from}:${className}`;
    if (!decoratedLines.has(key)) {
      decoratedLines.add(key);
      ranges.push(Decoration.line({ class: className }).range(line.from));
    }
  };

  const tree = ensureSyntaxTree(view.state, view.viewport.to, 50) || syntaxTree(view.state);
  tree.iterate({ enter(node) {
    if (!inactive(node.from)) return;
    const text = view.state.sliceDoc(node.from, node.to);
    if (/^ATXHeading[1-6]$/.test(node.name)) {
      const level = Number(node.name.charAt(node.name.length - 1));
      const marker = text.match(/^#{1,6}\s+/)?.[0];
      if (marker) ranges.push(Decoration.replace({}).range(node.from, node.from + marker.length));
      addLine(node.from, `cm-live-heading cm-live-heading-${level}`);
    } else if (node.name === "StrongEmphasis" || node.name === "Emphasis" || node.name === "Strikethrough" || node.name === "InlineCode") {
      const size = node.name === "StrongEmphasis" || node.name === "Strikethrough" ? 2 : 1;
      const className = node.name === "StrongEmphasis" ? "cm-live-strong"
        : node.name === "Emphasis" ? "cm-live-emphasis"
        : node.name === "Strikethrough" ? "cm-live-strike" : "cm-live-code";
      if (node.to - node.from > size * 2) {
        ranges.push(Decoration.replace({}).range(node.from, node.from + size));
        ranges.push(Decoration.mark({ class: className }).range(node.from + size, node.to - size));
        ranges.push(Decoration.replace({}).range(node.to - size, node.to));
      }
    } else if (node.name === "Link") {
      const match = text.match(/^\[([^\]]+)]\(([^)]+)\)$/);
      if (match) {
        const labelFrom = node.from + 1;
        const labelTo = labelFrom + match[1].length;
        ranges.push(Decoration.replace({}).range(node.from, labelFrom));
        ranges.push(Decoration.mark({ class: "cm-live-link", attributes: { title: match[2] } }).range(labelFrom, labelTo));
        ranges.push(Decoration.replace({}).range(labelTo, node.to));
      }
    } else if (node.name === "TaskMarker") {
      ranges.push(Decoration.replace({ widget: new TaskWidget(/^\[x]/i.test(text), node.from) }).range(node.from, node.to));
      if (/^\[x]/i.test(text)) addLine(node.from, "cm-live-task-done");
    } else if (node.name === "ListMark" && /^[*+-]$/.test(text)) {
      ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
    } else if (node.name === "QuoteMark") {
      ranges.push(Decoration.replace({ widget: new QuoteWidget() }).range(node.from, node.to));
      addLine(node.from, "cm-live-quote");
    } else if (node.name === "HorizontalRule") {
      ranges.push(Decoration.replace({ widget: new RuleWidget(), block: true }).range(node.from, node.to));
    } else if (node.name === "FencedCode" || node.name === "CodeBlock") {
      let line = view.state.doc.lineAt(node.from);
      const last = view.state.doc.lineAt(node.to).number;
      while (line.number <= last) {
        if (!activeLines.has(line.number)) addLine(line.from, "cm-live-codeblock");
        if (line.number === last) break;
        line = view.state.doc.line(line.number + 1);
      }
    }
  }});
  return Decoration.set(ranges, true);
}

class BulletWidget extends WidgetType {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-live-bullet";
    dot.textContent = "•";
    dot.setAttribute("aria-hidden", "true");
    return dot;
  }
}

class QuoteWidget extends WidgetType {
  toDOM() {
    const bar = document.createElement("span");
    bar.className = "cm-live-quote-mark";
    bar.setAttribute("aria-hidden", "true");
    return bar;
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-live-rule";
    rule.setAttribute("aria-hidden", "true");
    return rule;
  }
}

class TaskWidget extends WidgetType {
  constructor(private checked: boolean, private from: number) { super(); }

  eq(other: TaskWidget) { return other.checked === this.checked && other.from === this.from; }

  toDOM(view: EditorView) {
    const checkbox = document.createElement("input");
    checkbox.className = "cm-live-checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.setAttribute("aria-label", this.checked ? "标记为未完成" : "标记为已完成");
    checkbox.addEventListener("mousedown", (event) => event.preventDefault());
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: this.checked ? " " : "x" } });
      view.focus();
    });
    return checkbox;
  }

  ignoreEvent() { return true; }
}

function wrapSelection(view: EditorView, marker: string) {
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: `${marker}${selected}${marker}` },
    selection: EditorSelection.single(selection.from + marker.length, selection.to + marker.length),
    scrollIntoView: true
  });
  return true;
}

function insertLink(view: EditorView) {
  const selection = view.state.selection.main;
  const label = view.state.sliceDoc(selection.from, selection.to) || "链接文字";
  const inserted = `[${label}](https://)`;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: inserted },
    selection: EditorSelection.single(selection.from + inserted.length - 1),
    scrollIntoView: true
  });
  return true;
}
