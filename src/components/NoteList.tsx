import { useRef, useState } from "react";
import type { Category } from "../types/category";
import type { Note, NoteUpdate } from "../types/note";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { NoteCard } from "./NoteCard";

interface Props {
  notes: Note[];
  categories: Category[];
  loading: boolean;
  onToggleCompleted: (note: Note) => Promise<boolean>;
  onTogglePinned: (note: Note) => Promise<boolean>;
  onEdit: (id: number, input: NoteUpdate) => Promise<boolean>;
  onMove: (id: number, targetId: number, position: "before" | "after") => Promise<boolean>;
  onDelete: (id: number) => Promise<boolean>;
}

type DropTarget = { id: number; position: "before" | "after" };

export function NoteList({ notes, categories, loading, onToggleCompleted, onTogglePinned, onEdit, onMove, onDelete }: Props) {
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
    <div className="note-list">{notes.map((note, index) => <NoteCard key={note.id} note={note} categories={categories} isNew={index === 0}
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
      onEdit={(input) => onEdit(note.id, input)} onRequestDelete={() => setDeleteTarget(note)} />)}</div>
    <ConfirmDialog open={Boolean(deleteTarget)} title="删除这条事项？" message="删除后无法恢复。"
      onCancel={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) void onDelete(deleteTarget.id); setDeleteTarget(null); }} />
  </>;
}

function noteGroup(note: Note) {
  return note.completed ? "completed" : note.pinned ? "pinned" : "active";
}
