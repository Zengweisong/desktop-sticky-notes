import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus, Repeat2, X } from "lucide-react";
import type { Category } from "../types/category";
import type { Note, NoteInput, NoteUpdate } from "../types/note";
import type { RepeatSeries } from "../types/repeat";
import type { NoteTimeFilter } from "../types/filter";
import type { PriorityFilter } from "../types/settings";
import {
  buildCalendarEntries,
  buildMonthGrid,
  calendarRange,
  monthStart,
  noteCalendarDateKey,
  unscheduledNotes,
  type CalendarEntry
} from "../services/calendarService";
import { matchesNoteFilters } from "../services/noteFilterService";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoteCard } from "./NoteCard";

interface Props {
  notes: Note[];
  categories: Category[];
  repeatSeries: RepeatSeries[];
  loading: boolean;
  defaultCategoryId: number | null;
  timeFilter: NoteTimeFilter;
  categoryId: number | null;
  search: string;
  priority: PriorityFilter;
  onAdd: (input: NoteInput) => Promise<boolean>;
  onEdit: (id: number, input: NoteUpdate) => Promise<boolean>;
  onToggleCompleted: (note: Note) => Promise<boolean>;
  onTogglePinned: (note: Note) => Promise<boolean>;
  onToggleRepeatActive: (series: RepeatSeries) => Promise<boolean>;
  onDelete: (id: number, scope?: "occurrence" | "series") => Promise<boolean>;
  onReschedule: (note: Note, scheduledDate: string | null) => Promise<boolean>;
  today?: Date;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const MAX_CELL_TASKS = 2;
const DRAG_THRESHOLD = 8;
type DropTarget = { kind: "date"; date: string } | { kind: "unscheduled" };
interface DragCandidate { entry: CalendarEntry; pointerId: number; startX: number; startY: number; active: boolean }
interface DragState { entry: CalendarEntry; pointerX: number; pointerY: number; target: DropTarget | null }

export function CalendarView({ notes, categories, repeatSeries, loading, defaultCategoryId, timeFilter,
  categoryId, search, priority, onAdd, onEdit, onToggleCompleted, onTogglePinned,
  onToggleRepeatActive, onDelete, onReschedule, today }: Props) {
  const [stableToday, setStableToday] = useState(() => new Date(today || new Date()));
  const lastTodayKeyRef = useRef(localDateKey(stableToday));
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(stableToday));
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(stableToday));
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDate, setDraftDate] = useState(() => localDateKey(stableToday));
  const [draftTime, setDraftTime] = useState("");
  const [adding, setAdding] = useState(false);
  const [openedEntry, setOpenedEntry] = useState<CalendarEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [repeatDragWarning, setRepeatDragWarning] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dragCandidateRef = useRef<DragCandidate | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const suppressClickRef = useRef<string | null>(null);

  const days = useMemo(() => buildMonthGrid(visibleMonth, stableToday), [visibleMonth, stableToday]);
  const range = useMemo(() => calendarRange(days), [days]);
  const entries = useMemo(() => buildCalendarEntries(notes, repeatSeries, range.start, range.end)
    .filter((entry) => matchesNoteFilters(entry, timeFilter, categoryId, stableToday, search, priority)),
  [notes, repeatSeries, range.start, range.end, timeFilter, categoryId, stableToday, search, priority]);
  const entriesByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEntry[]>();
    for (const entry of entries) grouped.set(entry.dateKey, [...(grouped.get(entry.dateKey) || []), entry]);
    return grouped;
  }, [entries]);
  const selectedEntries = entriesByDate.get(selectedDate) || [];
  const undated = useMemo(() => unscheduledNotes(notes).filter((note) =>
    matchesNoteFilters(note, "undated", categoryId, stableToday, search, priority)),
  [notes, categoryId, stableToday, search, priority]);
  const openedNote = openedEntry ? noteForEntry(openedEntry) : null;

  useEffect(() => {
    if (today) {
      setStableToday(new Date(today));
      return;
    }
    let timer = 0;
    const refreshToday = () => {
      const now = new Date();
      setStableToday((current) => localDateKey(current) === localDateKey(now) ? current : now);
      window.clearTimeout(timer);
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(refreshToday, Math.max(1_000, nextMidnight.getTime() - now.getTime() + 100));
    };
    refreshToday();
    window.addEventListener("focus", refreshToday);
    document.addEventListener("visibilitychange", refreshToday);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshToday);
      document.removeEventListener("visibilitychange", refreshToday);
    };
  }, [today]);

  useEffect(() => {
    const nextKey = localDateKey(stableToday);
    const previousKey = lastTodayKeyRef.current;
    if (nextKey === previousKey) return;
    setDraftDate((current) => current === previousKey ? nextKey : current);
    lastTodayKeyRef.current = nextKey;
  }, [stableToday]);

  useEffect(() => {
    if (!openedEntry) return;
    const current = entries.find((entry) => entry.id === openedEntry.id)
      || notes.find((note) => `note-${note.id}` === openedEntry.id);
    if (!current) { setOpenedEntry(null); return; }
    if ("dateKey" in current) setOpenedEntry(current);
    else setOpenedEntry(entryFromNote(current, repeatSeries));
  }, [entries, notes, repeatSeries, openedEntry?.id]);

  useEffect(() => {
    const focusNote = (event: Event) => {
      const note = notes.find((item) => item.id === (event as CustomEvent<number>).detail);
      const dateKey = note ? noteCalendarDateKey(note) : null;
      if (!dateKey) {
        if (note) setShowUnscheduled(true);
        return;
      }
      const scheduled = parseDateKey(dateKey);
      setVisibleMonth(monthStart(scheduled));
      selectDate(dateKey);
    };
    window.addEventListener("focus-note", focusNote);
    return () => window.removeEventListener("focus-note", focusNote);
  }, [notes]);

  const selectDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setDraftDate(dateKey);
    setShowUnscheduled(false);
  };
  const moveMonth = (offset: number) => {
    const next = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
    setVisibleMonth(next);
    selectDate(localDateKey(next));
  };
  const goToday = () => {
    setVisibleMonth(monthStart(stableToday));
    selectDate(localDateKey(stableToday));
  };
  const submitQuickAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draftTitle.trim() || !draftDate || adding) return;
    setAdding(true);
    const created = await onAdd({
      title: draftTitle.trim(), categoryId: defaultCategoryId,
      scheduledDate: draftDate, scheduledTime: draftTime || null
    });
    if (created) setDraftTitle("");
    setAdding(false);
  };
  const openEntry = (entry: CalendarEntry) => {
    if (entry.note || entry.sourceNote) setOpenedEntry(entry);
  };
  const startDrag = (entry: CalendarEntry, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !entry.note || entry.virtual) return;
    dragCandidateRef.current = {
      entry, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const candidate = dragCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    const offsetX = event.clientX - candidate.startX;
    const offsetY = event.clientY - candidate.startY;
    if (!candidate.active && Math.hypot(offsetX, offsetY) < DRAG_THRESHOLD) return;
    candidate.active = true;
    const target = dropTargetAt(event.clientX, event.clientY);
    dropTargetRef.current = target;
    setDragState({ entry: candidate.entry, pointerX: event.clientX, pointerY: event.clientY, target });
    event.preventDefault();
  };
  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const candidate = dragCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    dragCandidateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const target = dropTargetRef.current;
    dropTargetRef.current = null;
    setDragState(null);
    if (!candidate.active) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = candidate.entry.id;
    window.setTimeout(() => { suppressClickRef.current = null; }, 0);
    if (!target || !candidate.entry.note) return;
    const originalDate = noteCalendarDateKey(candidate.entry.note);
    const targetDate = target.kind === "date" ? target.date : null;
    if (originalDate === targetDate) return;
    if (candidate.entry.note.repeatSeriesId != null) {
      setRepeatDragWarning(true);
      return;
    }
    if (targetDate) {
      selectDate(targetDate);
      const targetMonth = monthStart(parseDateKey(targetDate));
      if (targetMonth.getTime() !== visibleMonth.getTime()) setVisibleMonth(targetMonth);
    } else {
      setShowUnscheduled(true);
    }
    void onReschedule(candidate.entry.note, targetDate);
  };
  const cancelDrag = () => {
    dragCandidateRef.current = null;
    dropTargetRef.current = null;
    setDragState(null);
  };

  if (loading) return <div className="loading-state"><span /><span /><span /></div>;

  return <div className={`calendar-view ${dragState ? "drag-active" : ""}`}>
    <section className="calendar-main" aria-label="月历">
      <header className="calendar-toolbar">
        <div className="calendar-month-heading"><CalendarDays size={16} /><strong>{formatMonth(visibleMonth)}</strong></div>
        <div className="calendar-toolbar-actions">
          <button type="button" className="calendar-today" onClick={goToday}>今天</button>
          <button type="button" aria-label="上一个月" title="上一个月" onClick={() => moveMonth(-1)}><ChevronLeft size={16} /></button>
          <button type="button" aria-label="下一个月" title="下一个月" onClick={() => moveMonth(1)}><ChevronRight size={16} /></button>
        </div>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="calendar-grid" role="grid" aria-label={formatMonth(visibleMonth)}>
        {days.map((day) => {
          const dayEntries = entriesByDate.get(day.key) || [];
          const hiddenCount = Math.max(0, dayEntries.length - MAX_CELL_TASKS);
          const dropActive = dragState?.target?.kind === "date" && dragState.target.date === day.key;
          return <div key={day.key} role="gridcell" tabIndex={0} data-date={day.key}
            aria-label={`${formatFullDate(day.date)}，${dayEntries.length} 项`}
            className={`calendar-day ${day.inMonth ? "" : "outside-month"} ${day.isToday ? "today" : ""} ${selectedDate === day.key && !showUnscheduled ? "selected" : ""} ${dropActive ? "drop-active" : ""}`}
            onClick={() => selectDate(day.key)} onDoubleClick={() => { selectDate(day.key); titleInputRef.current?.focus(); }} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectDate(day.key); }
            }}>
            <span className="calendar-day-number">{day.date.getDate()}</span>
            <div className="calendar-day-tasks">
              {dayEntries.slice(0, MAX_CELL_TASKS).map((entry) => <button type="button" key={entry.id}
                data-note-id={entry.note?.id}
                className={`calendar-task ${entry.completed ? "completed" : ""} ${entry.virtual ? "virtual" : ""} ${dragState?.entry.id === entry.id ? "dragging" : ""}`}
                title={`${entry.title}${entry.virtual ? "（重复任务）" : ""}`}
                onPointerDown={(event) => startDrag(entry, event)} onPointerMove={moveDrag}
                onPointerUp={finishDrag} onPointerCancel={cancelDrag}
                onClick={(event) => { event.stopPropagation(); if (suppressClickRef.current === entry.id) return; selectDate(day.key); openEntry(entry); }}>
                <i style={{ backgroundColor: categoryColor(categories, entry.categoryId) }} />
                {entry.scheduledTime && <time>{entry.scheduledTime}</time>}<span>{entry.title}</span>{entry.virtual && <Repeat2 size={10} />}
              </button>)}
              {hiddenCount > 0 && <button type="button" className="calendar-more" onClick={(event) => {
                event.stopPropagation(); selectDate(day.key);
              }}>+{hiddenCount}</button>}
            </div>
          </div>;
        })}
      </div>
    </section>

    <aside className="calendar-agenda" aria-label={showUnscheduled ? "未安排事项" : "所选日期事项"}>
      <button type="button" data-drop-unscheduled className={`unscheduled-trigger ${showUnscheduled ? "selected" : ""} ${dragState?.target?.kind === "unscheduled" ? "drop-active" : ""}`}
        onClick={() => setShowUnscheduled(true)}><Clock3 size={14} /><span>未安排</span><b>{undated.length}</b></button>
      {showUnscheduled ? <>
        <div className="calendar-agenda-heading"><div><small>无日期任务</small><strong>未安排事项</strong></div><span>{undated.length} 项</span></div>
        <div className="calendar-agenda-list">
          {undated.map((note) => { const entry = entryFromNote(note, repeatSeries); return <button type="button" className={`agenda-task ${note.completed ? "completed" : ""} ${dragState?.entry.id === entry.id ? "dragging" : ""}`} key={note.id}
            data-note-id={note.id}
            onPointerDown={(event) => startDrag(entry, event)} onPointerMove={moveDrag}
            onPointerUp={finishDrag} onPointerCancel={cancelDrag}
            onClick={() => { if (suppressClickRef.current !== entry.id) setOpenedEntry(entry); }}>
            <i style={{ backgroundColor: categoryColor(categories, note.categoryId) }} /><span>{note.title}</span>
          </button>; })}
          {!undated.length && <p className="calendar-agenda-empty">没有未安排事项</p>}
        </div>
      </> : <>
        <div className="calendar-agenda-heading"><div><small>{formatWeekday(selectedDate)}</small><strong>{formatSelectedDate(selectedDate)}</strong></div><span>{selectedEntries.length} 项</span></div>
        <div className="calendar-agenda-list">
          {selectedEntries.map((entry) => <button type="button" className={`agenda-task ${entry.completed ? "completed" : ""}`} key={entry.id}
            data-note-id={entry.note?.id}
            disabled={!entry.note && !entry.sourceNote} title={!entry.note && !entry.sourceNote ? "该系列暂无可编辑实例" : entry.title}
            onClick={() => openEntry(entry)}>
            <i style={{ backgroundColor: categoryColor(categories, entry.categoryId) }} /><span>{entry.title}</span>
            {entry.scheduledTime && <time>{entry.scheduledTime}</time>}
            {entry.virtual && <Repeat2 size={11} />}
          </button>)}
          {!selectedEntries.length && <p className="calendar-agenda-empty">这一天还没有事项</p>}
        </div>
        <form className="calendar-quick-add" onSubmit={submitQuickAdd}>
          <input ref={titleInputRef} value={draftTitle} disabled={adding} aria-label="新事项标题"
            placeholder="为这一天添加事项" onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
            }} />
          <div><label><span>日期</span><input type="date" aria-label="新事项日期" value={draftDate}
            onChange={(event) => { setDraftDate(event.target.value); setSelectedDate(event.target.value); }} /></label>
            <div className="calendar-quick-time"><input type="time" aria-label="新事项时间" value={draftTime}
              onChange={(event) => setDraftTime(event.target.value)} />
              {draftTime && <button type="button" className="calendar-time-clear" aria-label="清除新事项时间"
                onClick={() => setDraftTime("")}><X size={10} /></button>}</div>
            <button type="submit" disabled={adding || !draftTitle.trim()} aria-label="添加到所选日期"><Plus size={15} /></button></div>
        </form>
      </>}
    </aside>

    {openedEntry && openedNote && <div className="dialog-backdrop board-detail-backdrop" onMouseDown={() => setOpenedEntry(null)}>
      <div className="board-detail-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="board-detail-heading"><strong>{openedEntry.virtual ? "重复事项详情" : "事项详情"}</strong>
          <button type="button" aria-label="关闭详情" title="关闭详情" onClick={() => setOpenedEntry(null)}><X size={16} /></button></div>
        <NoteCard key={openedEntry.id} note={openedNote} repeatSeries={openedEntry.series || undefined}
          virtualOccurrence={openedEntry.virtual} categories={categories}
          onPointerDown={() => undefined} onPointerMove={() => undefined} onPointerUp={() => undefined} onPointerCancel={() => undefined}
          onToggleCompleted={() => openedEntry.note ? onToggleCompleted(openedEntry.note) : Promise.resolve(false)}
          onTogglePinned={() => openedEntry.note ? onTogglePinned(openedEntry.note) : Promise.resolve(false)}
          onToggleRepeatActive={openedEntry.series ? () => onToggleRepeatActive(openedEntry.series!) : undefined}
          onEdit={(input) => onEdit((openedEntry.note || openedEntry.sourceNote)!.id, input)}
          onRequestDelete={() => { if (openedEntry.note) { setDeleteTarget(openedEntry.note); setOpenedEntry(null); } }} />
      </div>
    </div>}

    {deleteTarget?.repeatSeriesId != null ? <div className="dialog-backdrop" onMouseDown={() => setDeleteTarget(null)}>
      <div className="confirm-dialog repeat-delete-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <h3>删除重复事项</h3><p>只删除本次不会影响后续生成；删除整个系列会移除所有实例并停止生成。</p>
        <div className="dialog-actions"><button onClick={() => setDeleteTarget(null)}>取消</button>
          <button onClick={() => { void onDelete(deleteTarget.id, "occurrence"); setDeleteTarget(null); }}>仅删除本次</button>
          <button className="danger" onClick={() => { void onDelete(deleteTarget.id, "series"); setDeleteTarget(null); }}>删除整个系列</button></div>
      </div>
    </div> : <ConfirmDialog open={Boolean(deleteTarget)} title="删除这条事项？" message="删除后无法恢复。"
      onCancel={() => setDeleteTarget(null)} onConfirm={() => {
        if (deleteTarget) void onDelete(deleteTarget.id, "occurrence"); setDeleteTarget(null);
      }} />}
    <ConfirmDialog open={repeatDragWarning} title="暂不移动重复事项"
      message="当前版本无法安全拆分拖动后的单次实例，因此没有修改本次或整个重复系列。请在事项详情中选择编辑范围。"
      confirmText="知道了" onCancel={() => setRepeatDragWarning(false)} onConfirm={() => setRepeatDragWarning(false)} />
    {dragState && <div className={`calendar-drag-preview ${dragState.target ? "valid" : "invalid"}`} aria-hidden="true"
      style={{ left: dragState.pointerX + 10, top: dragState.pointerY + 10 }}>
      {dragState.entry.scheduledTime && <time>{dragState.entry.scheduledTime}</time>}
      <span>{dragState.entry.title}</span>
    </div>}
  </div>;
}

function noteForEntry(entry: CalendarEntry): Note | null {
  if (entry.note) return entry.note;
  if (!entry.sourceNote) return null;
  return { ...entry.sourceNote, title: entry.title, details: entry.details, categoryId: entry.categoryId,
    priority: entry.priority, scheduledAt: entry.occurrenceAt, scheduledDate: entry.dateKey,
    scheduledTime: entry.scheduledTime, repeatOccurrenceAt: entry.occurrenceAt,
    completed: false, completedAt: null, pinned: false };
}

function entryFromNote(note: Note, series: RepeatSeries[]): CalendarEntry {
  const occurrenceAt = note.scheduledAt;
  return { id: `note-${note.id}`, dateKey: noteCalendarDateKey(note) || "",
    occurrenceAt, title: note.title, details: note.details, categoryId: note.categoryId, priority: note.priority,
    completed: note.completed, scheduledAt: note.scheduledAt, scheduledDate: note.scheduledDate,
    scheduledTime: note.scheduledTime,
    sortOrder: note.sortOrder, dueAt: note.dueAt, reminderAt: note.reminderAt,
    note, sourceNote: note, series: series.find((item) => item.id === note.repeatSeriesId) || null, virtual: false };
}

function categoryColor(categories: Category[], categoryId: number | null) {
  return categories.find((category) => category.id === categoryId)?.color || "var(--faint)";
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dropTargetAt(clientX: number, clientY: number): DropTarget | null {
  const element = typeof document.elementFromPoint === "function" ? document.elementFromPoint(clientX, clientY) : null;
  const day = element?.closest<HTMLElement>("[data-date]");
  if (day?.dataset.date) return { kind: "date", date: day.dataset.date };
  if (element?.closest("[data-drop-unscheduled]")) return { kind: "unscheduled" };
  return null;
}

function formatMonth(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatFullDate(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatSelectedDate(dateKey: string) {
  const date = parseDateKey(dateKey);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatWeekday(dateKey: string) {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(parseDateKey(dateKey));
}
