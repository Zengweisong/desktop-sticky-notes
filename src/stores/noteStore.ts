import { create } from "zustand";
import type { Note } from "../types/note";

interface NoteState { notes: Note[]; loading: boolean; setNotes: (notes: Note[]) => void; setLoading: (loading: boolean) => void; }
export const useNoteStore = create<NoteState>((set) => ({
  notes: [], loading: true, setNotes: (notes) => set({ notes }), setLoading: (loading) => set({ loading })
}));
