import { create } from "zustand";
import type { Note } from "../types/note";
import type { RepeatSeries } from "../types/repeat";

interface NoteState {
  notes: Note[]; repeatSeries: RepeatSeries[]; loading: boolean;
  setNotes: (notes: Note[]) => void; setRepeatSeries: (series: RepeatSeries[]) => void;
  setLoading: (loading: boolean) => void;
}
export const useNoteStore = create<NoteState>((set) => ({
  notes: [], repeatSeries: [], loading: true,
  setNotes: (notes) => set({ notes }), setRepeatSeries: (repeatSeries) => set({ repeatSeries }),
  setLoading: (loading) => set({ loading })
}));
