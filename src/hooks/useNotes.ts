import { useCallback, useRef } from "react";
import { useNoteStore } from "../stores/noteStore";
import * as service from "../services/noteService";
import type { Note, NoteInput, NoteUpdate } from "../types/note";
import { listRepeatSeries } from "../services/repeatTaskService";
import { scheduledAtFromParts } from "../services/noteDateService";

type ScheduleSnapshot = Pick<Note,
  "scheduledDate" | "scheduledTime" | "scheduledAt" | "reminderEnabled" | "reminderAt">;

export function useNotes(onError: (message: string) => void) {
  const store = useNoteStore();
  const submitting = useRef(false);
  const rescheduleQueues = useRef(new Map<number, Promise<void>>());
  const rescheduleVersions = useRef(new Map<number, number>());
  const persistedSchedules = useRef(new Map<number, ScheduleSnapshot>());
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = refreshVersion.current + 1;
    refreshVersion.current = version;
    try {
      const [notes, repeatSeries] = await Promise.all([service.listNotes(), listRepeatSeries()]);
      if (refreshVersion.current !== version) return;
      store.setNotes(notes); store.setRepeatSeries(repeatSeries);
    }
    catch (error) { onError(error instanceof Error ? error.message : "读取事项失败"); }
    finally { if (refreshVersion.current === version) store.setLoading(false); }
  }, [onError, store.setNotes, store.setRepeatSeries, store.setLoading]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (submitting.current) return false;
    submitting.current = true;
    try { await action(); await refresh(); return true; }
    catch (error) { onError(error instanceof Error ? error.message : "操作失败"); return false; }
    finally { submitting.current = false; }
  }, [onError, refresh]);

  const reschedule = useCallback(async (note: Note, scheduledDate: string | null) => {
    if (note.repeatSeriesId != null) {
      onError("重复事项需要在详情中选择修改范围");
      return false;
    }
    const version = (rescheduleVersions.current.get(note.id) || 0) + 1;
    rescheduleVersions.current.set(note.id, version);
    if (!persistedSchedules.current.has(note.id)) persistedSchedules.current.set(note.id, scheduleSnapshot(note));
    useNoteStore.setState((state) => ({
      notes: state.notes.map((item) => item.id === note.id ? withScheduledDate(item, scheduledDate) : item)
    }));

    const previous = rescheduleQueues.current.get(note.id) || Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      await service.rescheduleNote(note.id, scheduledDate);
      const persisted = persistedSchedules.current.get(note.id) || scheduleSnapshot(note);
      persistedSchedules.current.set(note.id, scheduleSnapshot(withScheduledDate(note, scheduledDate, persisted)));
    });
    rescheduleQueues.current.set(note.id, operation);
    try {
      await operation;
      if (rescheduleVersions.current.get(note.id) === version) await refresh();
      return true;
    } catch (error) {
      if (rescheduleVersions.current.get(note.id) === version) {
        const persisted = persistedSchedules.current.get(note.id) || scheduleSnapshot(note);
        useNoteStore.setState((state) => ({
          notes: state.notes.map((item) => item.id === note.id ? { ...item, ...persisted } : item)
        }));
      }
      onError(error instanceof Error ? error.message : "修改事项日期失败");
      return false;
    } finally {
      if (rescheduleQueues.current.get(note.id) === operation) {
        rescheduleQueues.current.delete(note.id);
        rescheduleVersions.current.delete(note.id);
        persistedSchedules.current.delete(note.id);
      }
    }
  }, [onError, refresh]);

  return {
    notes: store.notes, repeatSeries: store.repeatSeries, loading: store.loading, refresh,
    add: (input: NoteInput) => run(() => service.createNote(input).then(() => undefined)),
    edit: (id: number, input: NoteUpdate) => run(() => service.updateNote(id, input)),
    toggleCompleted: (id: number, value: boolean) => run(() => service.setNoteCompleted(id, value)),
    togglePinned: (id: number, value: boolean) => run(() => service.setNotePinned(id, value)),
    toggleRepeatActive: (seriesId: number, value: boolean) => run(() => service.setRepeatActive(seriesId, value)),
    move: (id: number, targetId: number, position: "before" | "after") => run(() => service.moveNote(id, targetId, position)),
    reschedule,
    remove: (id: number, scope: "occurrence" | "series" = "occurrence") => run(() => service.deleteNote(id, scope)),
    clearCompleted: () => run(service.clearCompletedNotes)
  };
}

function withScheduledDate(note: Note, scheduledDate: string | null, source: ScheduleSnapshot = note): Note {
  const scheduledTime = scheduledDate ? note.scheduledTime : null;
  return {
    ...note,
    scheduledDate,
    scheduledTime,
    scheduledAt: scheduledAtFromParts(scheduledDate, scheduledTime),
    reminderEnabled: scheduledDate ? source.reminderEnabled : false,
    reminderAt: scheduledDate ? source.reminderAt : null
  };
}

function scheduleSnapshot(note: ScheduleSnapshot): ScheduleSnapshot {
  return {
    scheduledDate: note.scheduledDate,
    scheduledTime: note.scheduledTime,
    scheduledAt: note.scheduledAt,
    reminderEnabled: note.reminderEnabled,
    reminderAt: note.reminderAt
  };
}
