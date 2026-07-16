import { useRef, useState } from "react";
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
  onToggleCompleted: (note: Note) => Promise<boolean>;
  onTogglePinned: (note: Note) => Promise<boolean>;
  onToggleRepeatActive?: (series: RepeatSeries) => Promise<boolean>;
  onEdit: (id: number, input: NoteUpdate) => Promise<boolean>;
  onMove: (id: number, targetId: number, position: "before" | "after") => Promise<boolean>;
  onDelete: (id: number, scope?: "occurrence" | "series") => Promise<boolean>;
}

type DropTarget = { id: number; position: "before" | "after" };

export function NoteList({ notes, categories, repeatSeries = [], loading, onToggleCompleted, onTogglePinned, onToggleRepeatActive, onEdit, onMove, onDelete }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const draggedIdRef = useRef<number | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  if (loading) return <div className="loading-state"><span /><span /><span /></div>;
  if (!notes.length) return <EmptyState />;
  const finishDrag = () => {
    draggedIdRef.current = null;
    dropTargetRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
  };
  return <>
    <div className="note-list">{notes.map((note, index) => {
      const series = repeatSeries.find((item) => item.id === note.repeatSeriesId);
      return <NoteCard key={note.id} note={note}
      repeatSeries={series} categories={categories} isNew={index === 0}
      dragging={draggedId === note.id} dropPosition={dropTarget?.id === note.id ? dropTarget.position : null}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        draggedIdRef.current = note.id;
        setDraggedId(note.id);
      }}
      onPointerMove={(event) => {
        if (draggedIdRef.current == null) return;
        event.preventDefault();
        const card = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".note-card");
        const targetId = Number(card?.dataset.noteId);
        const target = notes.find((item) => item.id === targetId);
        const source = notes.find((item) => item.id === draggedIdRef.current);
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
        if (sourceId != null && target) {
          void onMove(sourceId, target.id, target.position);
        }
        finishDrag();
      }}
      onPointerCancel={finishDrag}
      onToggleCompleted={() => onToggleCompleted(note)} onTogglePinned={() => onTogglePinned(note)}
      onToggleRepeatActive={series && onToggleRepeatActive ? () => onToggleRepeatActive(series) : undefined}
      onEdit={(input) => onEdit(note.id, input)} onRequestDelete={() => setDeleteTarget(note)} />;
    })}</div>
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
