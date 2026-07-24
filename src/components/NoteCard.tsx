import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bell, Calendar, Check, GripVertical, Pencil, Pin, PinOff, Repeat2, Trash2 } from "lucide-react";
import type { Category } from "../types/category";
import type { Note, NotePriority, NoteUpdate } from "../types/note";
import type { RepeatSeries } from "../types/repeat";
import { describeRepeat } from "../services/repeatTaskService";
import { TaskScheduleFields } from "./TaskScheduleFields";

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
}

export function NoteCard({ note, repeatSeries, categories, isNew, dragging, dragOffsetY = 0, dropPosition, onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
  onToggleCompleted, onTogglePinned, onToggleRepeatActive, onEdit, onRequestDelete, startEditing = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(startEditing);
  const [title, setTitle] = useState(note.title);
  const [details, setDetails] = useState(note.details || "");
  const [categoryId, setCategoryId] = useState(note.categoryId);
  const [priority, setPriority] = useState<NotePriority>(note.priority);
  const [schedule, setSchedule] = useState<NoteUpdate>(() => scheduleFrom(note, repeatSeries));
  const [overflows, setOverflows] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reminderClock, setReminderClock] = useState(0);
  const reminderVisible = isUpcomingReminder(note);
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLParagraphElement>(null);
  const detailsRef = useRef<HTMLParagraphElement>(null);
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
    setSchedule(scheduleFrom(note, repeatSeries));
  };
  const startEdit = () => { resetDraft(); setEditing(true); };
  const save = async () => {
    if (!editing || busy || composing.current) return;
    if (!title.trim()) { titleRef.current?.focus(); return; }
    setBusy(true);
    if (await onEdit({ ...schedule, title, details, categoryId, priority })) setEditing(false);
    setBusy(false);
  };
  const cancel = () => { resetDraft(); setEditing(false); };
  const handleEditorKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current) {
      event.preventDefault(); void save();
    }
  };
  const toggle = async (action: () => Promise<boolean>) => { if (busy) return; setBusy(true); await action(); setBusy(false); };
  const category = categories.find((item) => item.id === note.categoryId);
  const hasItemTime = Boolean(note.scheduledAt && note.repeatSeriesId == null);

  return <article className={`note-card ${note.completed ? "completed" : ""} ${isNew ? "note-enter" : ""} ${dragging ? "dragging" : ""} ${dropPosition ? `drop-${dropPosition}` : ""}`}
    data-note-id={note.id} style={{ "--drag-offset-y": `${dragOffsetY}px` } as React.CSSProperties}>
    <button className="drag-handle" disabled={editing || busy} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} aria-label="拖动调整顺序" title="拖动调整顺序"><GripVertical size={14} /></button>
    <button className={`check-button ${note.completed ? "checked" : ""}`} disabled={busy}
      onClick={() => void toggle(onToggleCompleted)} aria-label={note.completed ? "恢复事项" : "完成事项"}>
      {note.completed && <Check size={14} strokeWidth={3} />}
    </button>
    <div className="note-main">
      {editing ? <div className="note-edit-form" ref={editorRef}>
        <textarea ref={titleRef} value={title} rows={1} disabled={busy} placeholder="待办标题"
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onChange={(event) => setTitle(event.target.value)} onKeyDown={handleEditorKey} />
        <textarea value={details} rows={2} disabled={busy} placeholder="详细备注（可选）"
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onChange={(event) => setDetails(event.target.value)} onKeyDown={handleEditorKey} />
        <div className="edit-section-title">分类与优先级</div>
        <div className="note-edit-fields">
          <select value={categoryId ?? ""} onChange={(event) => setCategoryId(Number(event.target.value))} aria-label="所属类别">
            {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select value={priority} onChange={(event) => setPriority(event.target.value as NotePriority)} aria-label="优先级">
            <option value="low">低优先级</option><option value="normal">普通</option><option value="high">高优先级</option>
          </select>
        </div>
        {repeatSeries && <label className="repeat-edit-scope"><span>编辑范围</span><select
          value={schedule.repeatEditScope || "occurrence"}
          onChange={(event) => setSchedule((current) => ({ ...current, repeatEditScope: event.target.value as "occurrence" | "series" }))}>
          <option value="occurrence">仅修改本次</option><option value="series">修改整个系列</option>
        </select></label>}
        <TaskScheduleFields value={{ ...schedule, title }} onChange={(patch) => setSchedule((current) => ({ ...current, ...patch }))} compact />
        <div className="note-edit-actions"><span>Enter 保存 · Esc 取消</span><button onClick={cancel}>取消</button><button onClick={() => void save()}>保存</button></div>
      </div> : <>
        <p ref={contentRef} className={expanded ? "expanded" : "clamped"}>{note.title}</p>
        {note.details && <p ref={detailsRef} className={`note-details ${expanded ? "" : "details-clamped"}`}>{note.details}</p>}
        {(overflows || expanded || reminderVisible || repeatSeries) && <button className="expand-button" onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "查看详情"}</button>}
        <div className="note-meta">
          {category && <span className="category-badge" title={category.name}><i style={{ backgroundColor: category.color }} />{category.name}</span>}
          {note.priority !== "normal" && <span className={`priority-badge ${note.priority}`}>{note.priority === "high" ? "高优先级" : "低优先级"}</span>}
          {hasItemTime && <span className={`due-badge ${isPlanPast(note) ? "overdue" : ""}`}><Calendar size={11} />{formatPlanTime(note)}</span>}
          {repeatSeries && <span className="repeat-badge"><Repeat2 size={11} />{describeRepeat(repeatSeries)}</span>}
          {reminderVisible && <span className="reminder-badge"><Bell size={11} />{formatReminder(note, Boolean(repeatSeries))}</span>}
        </div>
        {expanded && (reminderVisible || repeatSeries) && <div className="note-schedule-details">
          <div><b>事项时间</b><span>{hasItemTime ? formatPlanTime(note) : "未设置"}</span></div>
          {reminderVisible && <div><b>提醒</b><span>{formatReminder(note, Boolean(repeatSeries))}</span></div>}
          <div><b>重复规则</b><span>{repeatSeries ? `${describeRepeat(repeatSeries)} · ${repeatSeries.active ? "进行中" : "已暂停"}` : "不重复"}</span></div>
          {repeatSeries && onToggleRepeatActive && <button className="repeat-pause-button" disabled={busy}
            onClick={() => void toggle(onToggleRepeatActive)}>{repeatSeries.active ? "暂停后续生成" : "恢复后续生成"}</button>}
        </div>}
      </>}
    </div>
    {!editing && <div className="note-actions">
      <button onClick={() => void toggle(onTogglePinned)} title={note.pinned ? "取消置顶" : "置顶"}>{note.pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>
      <button onClick={startEdit} title="编辑"><Pencil size={15} /></button>
      <button className="danger-text" onClick={onRequestDelete} title="删除"><Trash2 size={15} /></button>
    </div>}
    {note.pinned && !editing && <Pin className="pin-marker" size={12} fill="currentColor" />}
  </article>;
}

function isPlanPast(note: Note) {
  if (note.completed || !note.scheduledAt) return false;
  return new Date(note.scheduledAt).getTime() < Date.now();
}

export function isUpcomingReminder(note: Note, now = Date.now()) {
  if (!note.reminderEnabled || !note.reminderAt || note.reminderTriggeredAt) return false;
  const reminderTime = new Date(note.reminderAt).getTime();
  return Number.isFinite(reminderTime) && reminderTime > now;
}

function scheduleFrom(note: Note, series?: RepeatSeries): NoteUpdate {
  const repeatStartDate = series ? localDatePart(series.startAt) : undefined;
  return {
    title: note.title,
    scheduledAt: note.scheduledAt,
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
    repeatEditScope: series ? "occurrence" : "series"
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
  if (!note.scheduledAt) return "未设置";
  return formatFullDateTime(note.scheduledAt);
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
