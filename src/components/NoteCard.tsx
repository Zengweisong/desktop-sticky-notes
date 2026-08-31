import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bell, BookOpen, Calendar, Check, Code2, GripVertical, Pin, PinOff, Repeat2, Sparkles, Trash2 } from "lucide-react";
import type { Category } from "../types/category";
import type { Note, NotePriority, NoteUpdate } from "../types/note";
import type { RepeatSeries } from "../types/repeat";
import { describeRepeat } from "../services/repeatTaskService";
import { TaskScheduleFields } from "./TaskScheduleFields";
import { MarkdownContent } from "./MarkdownContent";

const MarkdownEditor = lazy(() => import("./MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));

interface Props {
  note: Note;
  repeatSeries?: RepeatSeries;
  categories: Category[];
  isNew?: boolean;
  dragging?: boolean;
  dragOffsetY?: number;
  dropPosition?: "before" | "after" | null;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onToggleCompleted: () => Promise<boolean>;
  onTogglePinned: () => Promise<boolean>;
  onToggleRepeatActive?: () => Promise<boolean>;
  onEdit: (input: NoteUpdate) => Promise<boolean>;
  onRequestDelete: () => void;
  startEditing?: boolean;
  minimal?: boolean;
  /** Calendar-only projected occurrence. It edits the series without creating a database row. */
  virtualOccurrence?: boolean;
}

export function NoteCard({ note, repeatSeries, categories, isNew, dragging, dragOffsetY = 0, dropPosition, onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
  onToggleCompleted, onTogglePinned, onToggleRepeatActive, onEdit, onRequestDelete, startEditing = false, minimal = false, virtualOccurrence = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(startEditing);
  const [title, setTitle] = useState(note.title);
  const [details, setDetails] = useState(note.details || "");
  const [detailsMode, setDetailsMode] = useState<"live" | "source" | "preview">("live");
  const [categoryId, setCategoryId] = useState(note.categoryId);
  const [priority, setPriority] = useState<NotePriority>(note.priority);
  const [schedule, setSchedule] = useState<NoteUpdate>(() => scheduleFrom(note, repeatSeries, virtualOccurrence));
  const [overflows, setOverflows] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reminderClock, setReminderClock] = useState(0);
  const reminderVisible = isUpcomingReminder(note);
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLParagraphElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);

  useEffect(() => { if (editing) titleRef.current?.focus(); }, [editing]);
  useLayoutEffect(() => {
    const titleElement = contentRef.current;
    const detailsElement = detailsRef.current;
    if (!titleElement || expanded) return;
    setOverflows(titleElement.scrollHeight > titleElement.clientHeight + 1 || Boolean(detailsElement && detailsElement.scrollHeight > detailsElement.clientHeight + 1));
  }, [note.title, note.details, expanded]);
  useEffect(() => {
    if (!editing) return;
    const outside = (event: PointerEvent) => {
      if (!editorRef.current?.contains(event.target as Node)) void save();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [editing, title, details, categoryId, priority, schedule]);
  useEffect(() => {
    if (!reminderVisible) return;
    const reminderTime = new Date(note.reminderAt!).getTime();
    const delay = Math.min(Math.max(reminderTime - Date.now() + 50, 50), 2_147_483_647);
    const timer = window.setTimeout(() => setReminderClock((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [note.reminderAt, reminderVisible, reminderClock]);
  useEffect(() => {
    if (!reminderVisible && !repeatSeries && !overflows) setExpanded(false);
  }, [reminderVisible, repeatSeries, overflows]);

  const resetDraft = () => {
    setTitle(note.title); setDetails(note.details || ""); setCategoryId(note.categoryId);
    setPriority(note.priority);
    setSchedule(scheduleFrom(note, repeatSeries, virtualOccurrence));
    setDetailsMode("live");
  };
  const startEdit = () => { resetDraft(); setEditing(true); };
  const save = async () => {
    if (!editing || busy || composing.current) return;
    if (!title.trim()) { titleRef.current?.focus(); return; }
    setBusy(true);
    if (await onEdit({ ...schedule, title, details, categoryId, priority,
      repeatEditScope: virtualOccurrence ? "series" : schedule.repeatEditScope })) setEditing(false);
    setBusy(false);
  };
  const cancel = () => { resetDraft(); setEditing(false); };
  const handleEditorKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && !composing.current) {
      event.preventDefault(); void save();
    }
  };
  const handleDetailsKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter") {
      event.stopPropagation();
      return;
    }
    handleEditorKey(event);
  };
  const toggle = async (action: () => Promise<boolean>) => { if (busy) return; setBusy(true); await action(); setBusy(false); };
  const category = categories.find((item) => item.id === note.categoryId);
  const hasItemSchedule = Boolean(note.scheduledDate && note.repeatSeriesId == null);

  return <article className={`note-card ${minimal ? "minimal" : ""} ${note.completed ? "completed" : ""} ${isNew ? "note-enter" : ""} ${dragging ? "dragging" : ""} ${dropPosition ? `drop-${dropPosition}` : ""}`}
    data-note-id={note.id} tabIndex={editing ? undefined : 0} aria-label={editing ? undefined : `查看并编辑：${note.title}`}
    onClick={(event) => {
      if (editing || (event.target as Element).closest("button, a, input, textarea, select, [contenteditable='true']")) return;
      startEdit();
    }}
    onKeyDown={(event) => {
      if (!editing && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault(); startEdit();
      }
    }}
    style={{ "--drag-offset-y": `${dragOffsetY}px` } as React.CSSProperties}>
    <button className="drag-handle" disabled={editing || busy || virtualOccurrence} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} aria-label="拖动调整顺序" title="拖动调整顺序"><GripVertical size={14} /></button>
    <button className={`check-button ${note.completed ? "checked" : ""}`} disabled={busy || virtualOccurrence}
      onClick={() => void toggle(onToggleCompleted)} aria-label={note.completed ? "恢复事项" : "完成事项"}>
      {note.completed && <Check size={14} strokeWidth={3} />}
    </button>
    <div className="note-main">
      {editing ? <div className="note-edit-form" ref={editorRef}>
        <textarea ref={titleRef} value={title} rows={1} disabled={busy} placeholder="待办标题"
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onChange={(event) => setTitle(event.target.value)} onKeyDown={handleEditorKey} />
        <div className="markdown-editor">
          <div className="markdown-editor-toolbar">
            <span>详细备注 <small>Markdown</small></span>
            <div role="group" aria-label="备注编辑模式">
              <button type="button" className={detailsMode === "live" ? "selected" : ""} title="实时预览"
                aria-label="实时预览" aria-pressed={detailsMode === "live"} onClick={() => setDetailsMode("live")}><Sparkles size={12} /><span>实时</span></button>
              <button type="button" className={detailsMode === "source" ? "selected" : ""} title="Markdown 源码"
                aria-label="Markdown 源码" aria-pressed={detailsMode === "source"} onClick={() => setDetailsMode("source")}><Code2 size={12} /><span>源码</span></button>
              <button type="button" className={detailsMode === "preview" ? "selected" : ""}
                title="阅读预览" aria-label="阅读预览" aria-pressed={detailsMode === "preview"} onClick={() => setDetailsMode("preview")}><BookOpen size={12} /><span>阅读</span></button>
            </div>
          </div>
          {detailsMode === "live" ? <Suspense fallback={<textarea value={details} rows={4} disabled={busy}
            aria-label="备注内容" onChange={(event) => setDetails(event.target.value)} onKeyDown={handleDetailsKey} />}>
            <MarkdownEditor value={details} disabled={busy} onChange={setDetails} onCancel={cancel}
              onCompositionChange={(value) => { composing.current = value; }} />
          </Suspense>
          : detailsMode === "source" ? <textarea value={details} rows={4} disabled={busy} aria-label="详细备注源码"
            placeholder="支持 Markdown，例如 **重点**、- 列表、[链接](https://...)"
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onChange={(event) => setDetails(event.target.value)} onKeyDown={handleDetailsKey} />
          : <div className="markdown-preview" aria-label="详细备注预览">
            {details.trim() ? <MarkdownContent content={details} /> : <span>暂无内容</span>}
          </div>}
        </div>
        <div className="edit-section-title">分类与优先级</div>
        <div className="note-edit-fields">
          <select value={categoryId ?? ""} onChange={(event) => setCategoryId(Number(event.target.value))} aria-label="所属类别">
            {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select value={priority} onChange={(event) => setPriority(event.target.value as NotePriority)} aria-label="优先级">
            <option value="low">低优先级</option><option value="normal">普通</option><option value="high">高优先级</option>
          </select>
        </div>
        {repeatSeries && !virtualOccurrence && <label className="repeat-edit-scope"><span>编辑范围</span><select
          value={schedule.repeatEditScope || "occurrence"}
          onChange={(event) => setSchedule((current) => ({ ...current, repeatEditScope: event.target.value as "occurrence" | "series" }))}>
          <option value="occurrence">仅修改本次</option><option value="series">修改整个系列</option>
        </select></label>}
        {repeatSeries && virtualOccurrence && <div className="virtual-occurrence-note">这是尚未生成的重复实例，修改将应用到整个系列。</div>}
        <TaskScheduleFields value={{ ...schedule, title }} onChange={(patch) => setSchedule((current) => ({ ...current, ...patch }))} compact />
        <div className="note-edit-actions"><span>Enter 保存 · Esc 取消</span><button onClick={cancel}>取消</button><button onClick={() => void save()}>保存</button></div>
      </div> : <>
        <p ref={contentRef} className={expanded ? "expanded" : "clamped"}>{note.title}</p>
        {!minimal && note.details && <div ref={detailsRef} className={`note-details ${expanded ? "" : "details-clamped"}`}>
          <MarkdownContent content={note.details} />
        </div>}
        {!minimal && (overflows || expanded || reminderVisible || repeatSeries) && <button className="expand-button" onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "查看详情"}</button>}
        {!minimal && <div className="note-meta">
          {category && <span className={`category-badge ${category.isSystem ? "system-category" : ""}`} title={category.name}><i style={{ backgroundColor: category.color }} />{category.name}</span>}
          {note.priority !== "normal" && <span className={`priority-badge ${note.priority}`}>{note.priority === "high" ? "高优先级" : "低优先级"}</span>}
          {hasItemSchedule && <span className={`due-badge ${isPlanPast(note) ? "overdue" : ""}`}><Calendar size={11} />{formatPlanTime(note)}</span>}
          {repeatSeries && <span className="repeat-badge"><Repeat2 size={11} />{describeRepeat(repeatSeries)}</span>}
          {reminderVisible && <span className="reminder-badge"><Bell size={11} />{formatReminder(note, Boolean(repeatSeries))}</span>}
        </div>}
        {!minimal && expanded && (reminderVisible || repeatSeries) && <div className="note-schedule-details">
          <div><b>事项时间</b><span>{hasItemSchedule ? formatPlanTime(note) : "未设置"}</span></div>
          {reminderVisible && <div><b>提醒</b><span>{formatReminder(note, Boolean(repeatSeries))}</span></div>}
          <div><b>重复规则</b><span>{repeatSeries ? `${describeRepeat(repeatSeries)} · ${repeatSeries.active ? "进行中" : "已暂停"}` : "不重复"}</span></div>
          {repeatSeries && onToggleRepeatActive && <button className="repeat-pause-button" disabled={busy}
            onClick={() => void toggle(onToggleRepeatActive)}>{repeatSeries.active ? "暂停后续生成" : "恢复后续生成"}</button>}
        </div>}
      </>}
    </div>
    {!editing && <div className="note-actions">
      {!virtualOccurrence && <button onClick={() => void toggle(onTogglePinned)} title={note.pinned ? "取消置顶" : "置顶"}>{note.pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>}
      {!virtualOccurrence && <button className="danger-text" onClick={onRequestDelete} title="删除"><Trash2 size={15} /></button>}
    </div>}
    {note.pinned && !editing && <Pin className="pin-marker" size={12} fill="currentColor" />}
  </article>;
}

function isPlanPast(note: Note) {
  if (note.completed || !note.scheduledDate) return false;
  if (note.scheduledAt && note.scheduledTime) return new Date(note.scheduledAt).getTime() < Date.now();
  return note.scheduledDate < localDatePart(new Date().toISOString());
}

export function isUpcomingReminder(note: Note, now = Date.now()) {
  if (!note.reminderEnabled || !note.reminderAt || note.reminderTriggeredAt) return false;
  const reminderTime = new Date(note.reminderAt).getTime();
  return Number.isFinite(reminderTime) && reminderTime > now;
}

function scheduleFrom(note: Note, series?: RepeatSeries, virtualOccurrence = false): NoteUpdate {
  const repeatStartDate = series ? localDatePart(series.startAt) : undefined;
  return {
    title: note.title,
    scheduledAt: note.scheduledAt,
    scheduledDate: note.scheduledDate,
    scheduledTime: note.scheduledTime,
    reminderEnabled: series ? false : note.reminderEnabled,
    reminderOffsetMinutes: series ? 10 : note.reminderOffsetMinutes,
    legacyReminderAt: !series && isLegacyReminder(note) ? note.reminderAt : null,
    repeatEnabled: Boolean(series),
    repeatType: series?.repeatType || "daily",
    repeatInterval: series?.repeatInterval || 1,
    repeatWeekdays: series?.repeatWeekdays || [],
    repeatMonthDay: series?.repeatMonthDay,
    repeatEndType: series?.endType || "never",
    repeatEndDate: series?.endDate,
    repeatMaxOccurrences: series?.maxOccurrences,
    repeatStartDate,
    repeatReminderEnabled: series?.defaultReminderEnabled ?? true,
    repeatReminderTime: series?.defaultReminderTime || "09:00",
    repeatEditScope: series && !virtualOccurrence ? "occurrence" : "series"
  };
}

function formatReminder(note: Note, recurring: boolean) {
  if (recurring) return `${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(note.reminderAt!))} 提醒`;
  return formatFullDateTime(note.reminderAt!);
}

function isLegacyReminder(note: Note) {
  if (!note.reminderEnabled || !note.reminderAt) return false;
  if (!note.scheduledAt) return true;
  const plan = new Date(note.scheduledAt);
  const expected = plan.getTime() - note.reminderOffsetMinutes * 60_000;
  return Math.abs(expected - new Date(note.reminderAt).getTime()) > 60_000;
}

function formatPlanTime(note: Note) {
  if (!note.scheduledDate) return "未设置";
  const [year, month, day] = note.scheduledDate.split("-").map(Number);
  const date = `${month}月${day}日`;
  return note.scheduledTime ? `${date} ${note.scheduledTime}` : date;
}

function formatFullDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

function localDatePart(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
