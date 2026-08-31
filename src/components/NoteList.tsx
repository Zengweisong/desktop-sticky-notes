import { useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Category } from "../types/category";
import type { Note, NoteUpdate } from "../types/note";
import type { RepeatSeries } from "../types/repeat";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { NoteCard } from "./NoteCard";

interface Props {
  notes: Note[];
  categories: Category[];
  repeatSeries?: RepeatSeries[];
  loading: boolean;
  minimal?: boolean;
  showCompleted?: boolean;
  completedExpanded?: boolean;
  onCompletedExpandedChange?: (expanded: boolean) => void;
  onToggleCompleted: (note: Note) => Promise<boolean>;
  onTogglePinned: (note: Note) => Promise<boolean>;
  onToggleRepeatActive?: (series: RepeatSeries) => Promise<boolean>;
  onEdit: (id: number, input: NoteUpdate) => Promise<boolean>;
  onMove: (id: number, targetId: number, position: "before" | "after") => Promise<boolean>;
  onDelete: (id: number, scope?: "occurrence" | "series") => Promise<boolean>;
}

type DropTarget = { id: number; position: "before" | "after" };

export function NoteList({ notes, categories, repeatSeries = [], loading, minimal = false, showCompleted = false, completedExpanded = false,
  onCompletedExpandedChange, onToggleCompleted, onTogglePinned, onToggleRepeatActive, onEdit, onMove, onDelete }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const draggedIdRef = useRef<number | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const dragStartYRef = useRef(0);
  const dragActivatedRef = useRef(false);
  if (loading) return <div className="loading-state"><span /><span /><span /></div>;
  const activeNotes = notes.filter((note) => !note.completed);
  const completedNotes = notes.filter((note) => note.completed);
  const finishDrag = () => {
    draggedIdRef.current = null;
    dropTargetRef.current = null;
    setDraggedId(null);
    setDragOffsetY(0);
    setDropTarget(null);
    dragActivatedRef.current = false;
  };
  const renderNotes = (items: Note[], completedGroup = false) => <div className={`note-list ${completedGroup ? "completed-note-list" : ""}`}>{items.map((note, index) => {
      const series = repeatSeries.find((item) => item.id === note.repeatSeriesId);
      return <NoteCard key={note.id} note={note}
      repeatSeries={series} categories={categories} minimal={minimal} isNew={!completedGroup && index === 0}
      dragging={draggedId === note.id} dropPosition={dropTarget?.id === note.id ? dropTarget.position : null}
      dragOffsetY={draggedId === note.id ? dragOffsetY : 0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        draggedIdRef.current = note.id;
        dragStartYRef.current = event.clientY;
        dragActivatedRef.current = false;
        setDragOffsetY(0);
      }}
      onPointerMove={(event) => {
        if (draggedIdRef.current == null) return;
        event.preventDefault();
        const offsetY = event.clientY - dragStartYRef.current;
        if (!dragActivatedRef.current && Math.abs(offsetY) < 8) return;
        if (!dragActivatedRef.current) {
          dragActivatedRef.current = true;
          setDraggedId(draggedIdRef.current);
        }
        setDragOffsetY(offsetY);
        const sourceId = draggedIdRef.current;
        const hitElements = typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(event.clientX, event.clientY)
          : [document.elementFromPoint(event.clientX, event.clientY)].filter(Boolean) as Element[];
        const card = hitElements
          .map((element) => element.closest<HTMLElement>(".note-card"))
          .find((candidate) => candidate && Number(candidate.dataset.noteId) !== sourceId);
        const targetId = Number(card?.dataset.noteId);
        const target = notes.find((item) => item.id === targetId);
        const source = notes.find((item) => item.id === sourceId);
        if (!card || !source || !target || source.id === target.id || noteGroup(source) !== noteGroup(target)) return;
        const rect = card.getBoundingClientRect();
        const next = { id: target.id, position: event.clientY < rect.top + rect.height / 2 ? "before" as const : "after" as const };
        dropTargetRef.current = next;
        setDropTarget(next);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const sourceId = draggedIdRef.current;
        const target = dropTargetRef.current;
        if (dragActivatedRef.current && sourceId != null && target) {
          void onMove(sourceId, target.id, target.position);
        }
        finishDrag();
      }}
      onPointerCancel={finishDrag}
      onToggleCompleted={() => onToggleCompleted(note)} onTogglePinned={() => onTogglePinned(note)}
      onToggleRepeatActive={series && onToggleRepeatActive ? () => onToggleRepeatActive(series) : undefined}
      onEdit={(input) => onEdit(note.id, input)} onRequestDelete={() => setDeleteTarget(note)} />;
    })}</div>;
  return <>
    {activeNotes.length ? renderNotes(activeNotes) : (!showCompleted || !completedNotes.length) && <EmptyState />}
    {showCompleted && completedNotes.length > 0 && <section className={`completed-section ${completedExpanded ? "expanded" : ""}`}>
      <button type="button" className="completed-section-trigger" aria-expanded={completedExpanded}
        onClick={() => onCompletedExpandedChange?.(!completedExpanded)}>
        <span>已完成 <b>{completedNotes.length}</b></span>
        {completedExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {completedExpanded && renderNotes(completedNotes, true)}
    </section>}
    {deleteTarget?.repeatSeriesId != null ? <div className="dialog-backdrop" onMouseDown={() => setDeleteTarget(null)}>
      <div className="confirm-dialog repeat-delete-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <h3>删除重复事项</h3><p>只删除本次不会影响后续生成；删除整个系列会移除所有实例并停止生成。</p>
        <div className="dialog-actions"><button onClick={() => setDeleteTarget(null)}>取消</button>
          <button onClick={() => { void onDelete(deleteTarget.id, "occurrence"); setDeleteTarget(null); }}>仅删除本次</button>
          <button className="danger" onClick={() => { void onDelete(deleteTarget.id, "series"); setDeleteTarget(null); }}>删除整个系列</button>
        </div>
      </div>
    </div> : <ConfirmDialog open={Boolean(deleteTarget)} title="删除这条事项？" message="删除后无法恢复。"
      onCancel={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) void onDelete(deleteTarget.id, "occurrence"); setDeleteTarget(null); }} />}
  </>;
}

function noteGroup(note: Note) {
  return note.completed ? "completed" : note.pinned ? "pinned" : "active";
}
