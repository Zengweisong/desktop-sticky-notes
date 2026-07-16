import { useCallback, useRef } from "react";
import { useNoteStore } from "../stores/noteStore";
import * as service from "../services/noteService";
import type { NoteInput, NoteUpdate } from "../types/note";
import { listRepeatSeries } from "../services/repeatTaskService";

export function useNotes(onError: (message: string) => void) {
  const store = useNoteStore();
  const submitting = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const [notes, repeatSeries] = await Promise.all([service.listNotes(), listRepeatSeries()]);
      store.setNotes(notes); store.setRepeatSeries(repeatSeries);
    }
    catch (error) { onError(error instanceof Error ? error.message : "读取事项失败"); }
    finally { store.setLoading(false); }
  }, [onError, store.setNotes, store.setRepeatSeries, store.setLoading]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (submitting.current) return false;
    submitting.current = true;
    try { await action(); await refresh(); return true; }
    catch (error) { onError(error instanceof Error ? error.message : "操作失败"); return false; }
    finally { submitting.current = false; }
  }, [onError, refresh]);

  return {
    notes: store.notes, repeatSeries: store.repeatSeries, loading: store.loading, refresh,
    add: (input: NoteInput) => run(() => service.createNote(input).then(() => undefined)),
    edit: (id: number, input: NoteUpdate) => run(() => service.updateNote(id, input)),
    toggleCompleted: (id: number, value: boolean) => run(() => service.setNoteCompleted(id, value)),
    togglePinned: (id: number, value: boolean) => run(() => service.setNotePinned(id, value)),
    toggleRepeatActive: (seriesId: number, value: boolean) => run(() => service.setRepeatActive(seriesId, value)),
    move: (id: number, targetId: number, position: "before" | "after") => run(() => service.moveNote(id, targetId, position)),
    remove: (id: number, scope: "occurrence" | "series" = "occurrence") => run(() => service.deleteNote(id, scope)),
    clearCompleted: () => run(service.clearCompletedNotes)
  };
}
