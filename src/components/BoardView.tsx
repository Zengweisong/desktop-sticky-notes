import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell, CalendarClock, Check, GripHorizontal, GripVertical,
  MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2, X
} from "lucide-react";
import type { BoardColumn } from "../types/board";
import type { Category } from "../types/category";
import type { Note, NoteInput, NoteUpdate } from "../types/note";
import type { RepeatSeries } from "../types/repeat";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoteCard } from "./NoteCard";

interface Props {
  columns: BoardColumn[];
  notes: Note[];
  categories: Category[];
  repeatSeries: RepeatSeries[];
  loading: boolean;
  selectedColumnId: string | null;
  onSelectedColumnChange: (id: string | null) => void;
  onAdd: (input: NoteInput) => Promise<boolean>;
  onEdit: (id: number, input: NoteUpdate) => Promise<boolean>;
  onToggleCompleted: (note: Note) => Promise<boolean>;
  onTogglePinned: (note: Note) => Promise<boolean>;
  onToggleRepeatActive: (series: RepeatSeries) => Promise<boolean>;
  onDelete: (id: number, scope?: "occurrence" | "series") => Promise<boolean>;
  onMoveNote: (id: number, columnId: string, targetId: number | null, position?: "before" | "after") => Promise<boolean>;
  onCreateColumn: (name: string) => Promise<boolean>;
  onRenameColumn: (id: string, name: string) => Promise<boolean>;
  onDeleteColumn: (id: string, moveToId?: string) => Promise<boolean>;
  onMoveColumn: (id: string, targetId: string, position: "before" | "after") => Promise<boolean>;
}

type CardDrop = { columnId: string; targetId: number | null; position: "before" | "after" };
type UndoMove = { noteId: number; columnId: string; targetId: number | null; position: "before" | "after" };

export function BoardView(props: Props) {
  const { columns, notes, categories, repeatSeries, loading } = props;
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [menuNoteId, setMenuNoteId] = useState<number | null>(null);
  const [menuColumnId, setMenuColumnId] = useState<string | null>(null);
  const [renamingColumnId, setRenamingColumnId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteColumnId, setDeleteColumnId] = useState<string | null>(null);
  const [moveDeletedNotesTo, setMoveDeletedNotesTo] = useState("");
  const [deleteNote, setDeleteNote] = useState<Note | null>(null);
  const [pendingDeleteNote, setPendingDeleteNote] = useState<Note | null>(null);
  const [openedNote, setOpenedNote] = useState<{ id: number; edit: boolean } | null>(null);
  const [dragNoteId, setDragNoteId] = useState<number | null>(null);
  const [dragPoint, setDragPoint] = useState({ x: 0, y: 0 });
  const [cardDrop, setCardDrop] = useState<CardDrop | null>(null);
  const [undoMove, setUndoMove] = useState<UndoMove | null>(null);
  const [columnDragId, setColumnDragId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; startX: number; startY: number; active: boolean } | null>(null);
  const dropRef = useRef<CardDrop | null>(null);
  const undoRef = useRef<UndoMove | null>(null);
  const deleteTimerRef = useRef<number | null>(null);
  const pendingDeleteRef = useRef<Note | null>(null);
  const deleteActionRef = useRef(props.onDelete);
  deleteActionRef.current = props.onDelete;

  const byColumn = useMemo(() => {
    const result = new Map<string, Note[]>();
    columns.forEach((column) => result.set(column.id, []));
    notes.forEach((note) => {
      if (note.id !== pendingDeleteNote?.id) result.get(note.boardColumnId)?.push(note);
    });
    result.forEach((items) => items.sort((left, right) => left.boardOrder - right.boardOrder));
    return result;
  }, [columns, notes, pendingDeleteNote?.id]);

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest(".board-more-wrap")) { setMenuNoteId(null); setMenuColumnId(null); }
    };
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, []);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAddingIn(null); setAddingColumn(false); setRenamingColumnId(null);
        setMenuNoteId(null); setMenuColumnId(null); setOpenedNote(null);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && undoRef.current) {
        event.preventDefault();
        const previous = undoRef.current;
        undoRef.current = null; setUndoMove(null);
        void props.onMoveNote(previous.noteId, previous.columnId, previous.targetId, previous.position);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [props.onMoveNote]);

  useEffect(() => {
    if (!undoMove) return;
    const timer = window.setTimeout(() => { undoRef.current = null; setUndoMove(null); }, 4500);
    return () => window.clearTimeout(timer);
  }, [undoMove]);

  useEffect(() => () => {
    if (deleteTimerRef.current != null) window.clearTimeout(deleteTimerRef.current);
    if (pendingDeleteRef.current) void deleteActionRef.current(pendingDeleteRef.current.id);
  }, []);

  const rememberOrigin = (note: Note): UndoMove => {
    const siblings = byColumn.get(note.boardColumnId) || [];
    const index = siblings.findIndex((item) => item.id === note.id);
    if (index >= 0 && index < siblings.length - 1) {
      return { noteId: note.id, columnId: note.boardColumnId, targetId: siblings[index + 1].id, position: "before" };
    }
    if (index > 0) return { noteId: note.id, columnId: note.boardColumnId, targetId: siblings[index - 1].id, position: "after" };
    return { noteId: note.id, columnId: note.boardColumnId, targetId: null, position: "after" };
  };

  const beginCardDrag = (event: React.PointerEvent<HTMLButtonElement>, note: Note) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: note.id, startX: event.clientX, startY: event.clientY, active: false };
    setDragPoint({ x: event.clientX, y: event.clientY });
    undoRef.current = rememberOrigin(note);
  };

  const moveCardDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault(); event.stopPropagation();
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    if (!drag.active) { drag.active = true; setDragNoteId(drag.id); }
    setDragPoint({ x: event.clientX, y: event.clientY });
    autoScroll(event.clientX, event.clientY);
    const elements = document.elementsFromPoint(event.clientX, event.clientY);
    const columnElement = elements.map((item) => item.closest<HTMLElement>(".board-column")).find(Boolean);
    if (!columnElement) { dropRef.current = null; setCardDrop(null); return; }
    const columnId = columnElement.dataset.columnId!;
    const card = elements.map((item) => item.closest<HTMLElement>(".board-card"))
      .find((item) => item && Number(item.dataset.noteId) !== drag.id);
    const targetId = card ? Number(card.dataset.noteId) : null;
    const position = card && event.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2
      ? "before" : "after";
    const next = { columnId, targetId, position } as CardDrop;
    dropRef.current = next; setCardDrop(next);
  };

  const finishCardDrag = (event?: React.PointerEvent<HTMLButtonElement>) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const drag = dragRef.current;
    const target = dropRef.current;
    if (drag?.active && target) {
      const previous = undoRef.current;
      void props.onMoveNote(drag.id, target.columnId, target.targetId, target.position).then((ok) => {
        if (ok && previous) { undoRef.current = previous; setUndoMove(previous); }
        else { undoRef.current = null; setUndoMove(null); }
      });
      props.onSelectedColumnChange(target.columnId);
    }
    dragRef.current = null; dropRef.current = null;
    setDragNoteId(null); setCardDrop(null);
  };

  const autoScroll = (x: number, y: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    if (x < rect.left + 34) viewport.scrollLeft -= 14;
    if (x > rect.right - 34) viewport.scrollLeft += 14;
    const columnBody = document.elementsFromPoint(x, y)
      .map((item) => item.closest<HTMLElement>(".board-column-body")).find(Boolean);
    if (!columnBody) return;
    const bodyRect = columnBody.getBoundingClientRect();
    if (y < bodyRect.top + 32) columnBody.scrollTop -= 12;
    if (y > bodyRect.bottom - 32) columnBody.scrollTop += 12;
  };

  const submitInlineNote = async (columnId: string) => {
    if (!newNoteTitle.trim()) return;
    if (await props.onAdd({ title: newNoteTitle, boardColumnId: columnId })) {
      setNewNoteTitle(""); setAddingIn(null); props.onSelectedColumnChange(columnId);
    }
  };

  const submitColumn = async () => {
    if (!newColumnName.trim()) return;
    if (await props.onCreateColumn(newColumnName)) { setNewColumnName(""); setAddingColumn(false); }
  };

  const scheduleDelete = (note: Note) => {
    if (deleteTimerRef.current != null) window.clearTimeout(deleteTimerRef.current);
    if (pendingDeleteRef.current) void props.onDelete(pendingDeleteRef.current.id);
    pendingDeleteRef.current = note;
    setPendingDeleteNote(note);
    setOpenedNote(null);
    deleteTimerRef.current = window.setTimeout(() => {
      const current = pendingDeleteRef.current;
      pendingDeleteRef.current = null; deleteTimerRef.current = null; setPendingDeleteNote(null);
      if (current) void props.onDelete(current.id);
    }, 4500);
  };

  const undoDelete = () => {
    if (deleteTimerRef.current != null) window.clearTimeout(deleteTimerRef.current);
    deleteTimerRef.current = null; pendingDeleteRef.current = null; setPendingDeleteNote(null);
  };

  const selectedOpenedNote = notes.find((note) => note.id === openedNote?.id);
  const selectedSeries = repeatSeries.find((series) => series.id === selectedOpenedNote?.repeatSeriesId);
  const deletingColumn = columns.find((column) => column.id === deleteColumnId);
  const deletingCount = deleteColumnId ? (byColumn.get(deleteColumnId)?.length || 0) : 0;

  if (loading) return <div className="loading-state"><span /><span /><span /></div>;

  return <>
    <div className="board-viewport" ref={viewportRef}>
      <div className="board-track">
        {columns.map((column) => {
          const columnNotes = byColumn.get(column.id) || [];
          const selected = props.selectedColumnId === column.id;
          return <section key={column.id} className={`board-column ${selected ? "selected" : ""} ${cardDrop?.columnId === column.id ? "drop-active" : ""} ${columnDragId === column.id ? "column-dragging" : ""}`}
            data-column-id={column.id} onPointerDown={() => props.onSelectedColumnChange(column.id)}
            onDragOver={(event) => { if (columnDragId && columnDragId !== column.id) event.preventDefault(); }}
            onDrop={(event) => {
              event.preventDefault();
              if (!columnDragId || columnDragId === column.id) return;
              const rect = event.currentTarget.getBoundingClientRect();
              void props.onMoveColumn(columnDragId, column.id, event.clientX < rect.left + rect.width / 2 ? "before" : "after");
              setColumnDragId(null);
            }}>
            <header className="board-column-header">
              <button className="column-drag-handle" draggable aria-label={`拖动 ${column.name} 栏目`}
                onDragStart={(event) => { setColumnDragId(column.id); event.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => setColumnDragId(null)}><GripHorizontal size={14} /></button>
              {renamingColumnId === column.id ? <input className="column-name-input" autoFocus value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)} onBlur={() => setRenamingColumnId(null)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setRenamingColumnId(null);
                  if (event.key === "Enter" && renameValue.trim()) {
                    void props.onRenameColumn(column.id, renameValue).then((ok) => ok && setRenamingColumnId(null));
                  }
                }} /> : <h3 onDoubleClick={() => {
                  if (column.type === "custom") { setRenameValue(column.name); setRenamingColumnId(column.id); }
                }}>{column.name}</h3>}
              <span className="board-count">{columnNotes.length}</span>
              {column.type === "custom" && <div className="board-more-wrap">
                <button className="board-more" aria-label={`${column.name} 更多操作`} aria-expanded={menuColumnId === column.id} onClick={(event) => {
                  event.stopPropagation(); setMenuColumnId((id) => id === column.id ? null : column.id);
                }}><MoreHorizontal size={16} /></button>
                {menuColumnId === column.id && <div className="board-menu column-menu">
                  <button onClick={() => { setRenameValue(column.name); setRenamingColumnId(column.id); setMenuColumnId(null); }}><Pencil size={13} />重命名</button>
                  <button className="danger" onClick={() => {
                    setDeleteColumnId(column.id); setMoveDeletedNotesTo(columns.find((item) => item.id !== column.id)?.id || ""); setMenuColumnId(null);
                  }}><Trash2 size={13} />删除栏目</button>
                </div>}
              </div>}
            </header>
            <div className="board-column-body">
              <div className="board-cards">
                {columnNotes.map((note) => <BoardCard key={note.id} note={note} categories={categories}
                  dragging={dragNoteId === note.id} drop={cardDrop?.targetId === note.id ? cardDrop.position : null}
                  menuOpen={menuNoteId === note.id} onMenu={() => setMenuNoteId((id) => id === note.id ? null : note.id)}
                  onOpen={() => setOpenedNote({ id: note.id, edit: false })}
                  onEdit={() => { setOpenedNote({ id: note.id, edit: true }); setMenuNoteId(null); }}
                  onToggleCompleted={() => props.onToggleCompleted(note)} onTogglePinned={() => props.onTogglePinned(note)}
                  onDelete={() => { setDeleteNote(note); setMenuNoteId(null); }}
                  onPointerDown={(event) => beginCardDrag(event, note)} onPointerMove={moveCardDrag}
                  onPointerUp={finishCardDrag} onPointerCancel={() => finishCardDrag()} />)}
                {!columnNotes.length && <div className="board-empty">暂无事项</div>}
              </div>
              {addingIn === column.id ? <div className="board-inline-add">
                <textarea autoFocus rows={1} value={newNoteTitle} placeholder="输入事项标题"
                  onChange={(event) => setNewNoteTitle(event.target.value)} onKeyDown={(event) => {
                    if (event.key === "Escape") { setAddingIn(null); setNewNoteTitle(""); }
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault(); void submitInlineNote(column.id);
                    }
                  }} /><button onClick={() => void submitInlineNote(column.id)}><Check size={14} /></button>
                <button onClick={() => { setAddingIn(null); setNewNoteTitle(""); }}><X size={14} /></button>
              </div> : <button className="board-add-note" onClick={() => { setAddingIn(column.id); setNewNoteTitle(""); }}><Plus size={14} />添加事项</button>}
            </div>
          </section>;
        })}
        <div className="add-column-slot">
          {addingColumn ? <div className="add-column-form"><input autoFocus value={newColumnName} placeholder="栏目名称"
            onChange={(event) => setNewColumnName(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Escape") setAddingColumn(false);
              if (event.key === "Enter") void submitColumn();
            }} /><button onClick={() => void submitColumn()}><Check size={14} /></button><button onClick={() => setAddingColumn(false)}><X size={14} /></button></div>
            : <button className="add-column-button" onClick={() => setAddingColumn(true)}><Plus size={14} />新增栏目</button>}
        </div>
      </div>
    </div>

    {dragNoteId != null && <div className="board-drag-preview" style={{ left: dragPoint.x + 12, top: dragPoint.y + 10 }}>
      {notes.find((note) => note.id === dragNoteId)?.title}
    </div>}
    {undoMove && <div className="board-undo-toast"><span>事项已移动</span><button onClick={() => {
      const previous = undoRef.current; undoRef.current = null; setUndoMove(null);
      if (previous) void props.onMoveNote(previous.noteId, previous.columnId, previous.targetId, previous.position);
    }}>撤销</button></div>}
    {pendingDeleteNote && <div className="board-undo-toast board-delete-undo"><span>事项已删除</span><button onClick={undoDelete}>撤销</button></div>}

    {selectedOpenedNote && openedNote && <div className="dialog-backdrop board-detail-backdrop" onMouseDown={() => setOpenedNote(null)}>
      <div className="board-detail-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="board-detail-heading"><strong>事项详情</strong><button onClick={() => setOpenedNote(null)}><X size={16} /></button></div>
        <NoteCard key={`${openedNote.id}-${openedNote.edit}`} note={selectedOpenedNote} repeatSeries={selectedSeries}
          categories={categories} startEditing={openedNote.edit} onPointerDown={() => undefined} onPointerMove={() => undefined}
          onPointerUp={() => undefined} onPointerCancel={() => undefined}
          onToggleCompleted={() => props.onToggleCompleted(selectedOpenedNote)}
          onTogglePinned={() => props.onTogglePinned(selectedOpenedNote)}
          onToggleRepeatActive={selectedSeries ? () => props.onToggleRepeatActive(selectedSeries) : undefined}
          onEdit={(input) => props.onEdit(selectedOpenedNote.id, input)} onRequestDelete={() => { setOpenedNote(null); setDeleteNote(selectedOpenedNote); }} />
      </div>
    </div>}

    <ConfirmDialog open={Boolean(deleteNote)} title="删除这条事项？" message="删除后可在几秒内撤销。"
      onCancel={() => setDeleteNote(null)} onConfirm={() => { if (deleteNote) scheduleDelete(deleteNote); setDeleteNote(null); }} />

    {deletingColumn && <div className="dialog-backdrop" onMouseDown={() => setDeleteColumnId(null)}>
      <div className="confirm-dialog board-delete-column-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <h3>删除“{deletingColumn.name}”？</h3>
        {deletingCount ? <><p>栏目内有 {deletingCount} 项，请先选择要移动到的栏目。事项不会被删除。</p>
          <select value={moveDeletedNotesTo} onChange={(event) => setMoveDeletedNotesTo(event.target.value)}>
            {columns.filter((column) => column.id !== deletingColumn.id).map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
          </select></> : <p>这个栏目没有事项，可以安全删除。</p>}
        <div className="dialog-actions"><button onClick={() => setDeleteColumnId(null)}>取消</button><button className="danger" onClick={() => {
          void props.onDeleteColumn(deletingColumn.id, deletingCount ? moveDeletedNotesTo : undefined).then((ok) => ok && setDeleteColumnId(null));
        }}>删除栏目</button></div>
      </div>
    </div>}
  </>;
}

function BoardCard({ note, categories, dragging, drop, menuOpen, onMenu, onOpen, onEdit, onToggleCompleted, onTogglePinned, onDelete,
  onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  note: Note; categories: Category[]; dragging: boolean; drop: "before" | "after" | null; menuOpen: boolean;
  onMenu: () => void; onOpen: () => void; onEdit: () => void; onToggleCompleted: () => Promise<boolean>;
  onTogglePinned: () => Promise<boolean>; onDelete: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void; onPointerCancel: () => void;
}) {
  const category = categories.find((item) => item.id === note.categoryId);
  return <article className={`board-card ${note.completed ? "completed" : ""} ${dragging ? "drag-placeholder" : ""} ${drop ? `drop-${drop}` : ""}`}
    data-note-id={note.id} onClick={onOpen}>
    {note.priority === "high" && <i className="high-priority-mark" />}
    <div className="board-card-mainline">
      <button className="board-card-drag" aria-label="拖动事项" onClick={(event) => event.stopPropagation()}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}><GripVertical size={14} /></button>
      <button className={`board-check ${note.completed ? "checked" : ""}`} aria-label={note.completed ? "恢复事项" : "完成事项"}
        onClick={(event) => { event.stopPropagation(); void onToggleCompleted(); }}>{note.completed && <Check size={11} strokeWidth={3} />}</button>
      <p>{note.title}</p>
      <div className="board-more-wrap">
        <button className="board-more" aria-label="事项更多操作" onClick={(event) => { event.stopPropagation(); onMenu(); }}><MoreHorizontal size={15} /></button>
        {menuOpen && <div className="board-menu note-menu" onClick={(event) => event.stopPropagation()}>
          <button onClick={onEdit}><Pencil size={13} />编辑</button>
          <button onClick={() => void onTogglePinned()}>{note.pinned ? <PinOff size={13} /> : <Pin size={13} />}{note.pinned ? "取消置顶" : "置顶"}</button>
          <button className="danger" onClick={onDelete}><Trash2 size={13} />删除</button>
        </div>}
      </div>
    </div>
    {(category || note.scheduledAt || note.reminderAt || note.priority !== "normal") && <div className="board-card-meta">
      {category && <span className="board-tag"><i style={{ backgroundColor: category.color }} />{category.name}</span>}
      {note.scheduledAt && <span title="事项时间"><CalendarClock size={10} />{shortDate(note.scheduledAt)}</span>}
      {note.reminderEnabled && note.reminderAt && <span title="提醒时间"><Bell size={10} />{shortDate(note.reminderAt)}</span>}
      {note.priority !== "normal" && <span>{note.priority === "high" ? "高" : "低"}</span>}
    </div>}
  </article>;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
