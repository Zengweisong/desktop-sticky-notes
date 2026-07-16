import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, SlidersHorizontal } from "lucide-react";
import type { Category } from "../types/category";
import type { NoteInput } from "../types/note";
import { TaskScheduleFields } from "./TaskScheduleFields";

interface Props {
  categories: Category[];
  categoryId: number | null;
  onCategoryChange: (id: number) => void;
  onAdd: (input: NoteInput) => Promise<boolean>;
}

export function QuickInput({ categories, categoryId, onCategoryChange, onAdd }: Props) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [schedule, setSchedule] = useState<NoteInput>({ title: "", reminderEnabled: false, repeatEnabled: false });
  const composing = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? categories[0];

  useEffect(() => {
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select(); };
    window.addEventListener("focus-quick-input", focus);
    return () => window.removeEventListener("focus-quick-input", focus);
  }, []);

  useEffect(() => {
    if (!categoryMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!categoryMenuRef.current?.contains(event.target as Node)) setCategoryMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCategoryMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [categoryMenuOpen]);

  const submit = async () => {
    if (!value.trim() || submitting || composing.current) return;
    setSubmitting(true);
    const ok = await onAdd({ ...schedule, title: value, categoryId });
    if (ok) {
      setValue(""); setAdvancedOpen(false);
      setSchedule({ title: "", reminderEnabled: false, repeatEnabled: false });
      inputRef.current?.focus();
    }
    setSubmitting(false);
  };

  return <div className={`quick-input-wrap ${advancedOpen ? "advanced" : ""}`}>
    <textarea
      ref={inputRef} value={value} rows={1} disabled={submitting}
      placeholder="输入事项，按 Enter 添加"
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current) {
          event.preventDefault(); void submit();
        }
      }}
    />
    <div className="quick-category-picker" ref={categoryMenuRef}>
      <button className="quick-category-trigger" type="button" aria-label="选择所属类别"
        aria-haspopup="listbox" aria-expanded={categoryMenuOpen} onClick={() => setCategoryMenuOpen((open) => !open)}>
        {selectedCategory && <i style={{ backgroundColor: selectedCategory.color }} />}
        <span>{selectedCategory?.name ?? "选择类别"}</span><ChevronDown size={13} />
      </button>
      {categoryMenuOpen && <div className="quick-category-menu" role="listbox" aria-label="所属类别">
        {categories.map((category) => <button key={category.id} type="button" role="option"
          aria-selected={category.id === categoryId} className={category.id === categoryId ? "selected" : ""}
          onClick={() => { onCategoryChange(category.id); setCategoryMenuOpen(false); }}>
          <i style={{ backgroundColor: category.color }} /><span>{category.name}</span>
          {category.id === categoryId && <Check size={13} />}
        </button>)}
      </div>}
    </div>
    <button className={`advanced-trigger ${advancedOpen ? "selected" : ""}`} type="button"
      onClick={() => setAdvancedOpen((open) => !open)} aria-label="提醒与重复设置" title="提醒与重复设置">
      <SlidersHorizontal size={15} />
    </button>
    <button className="add-button" disabled={!value.trim() || submitting} onClick={() => void submit()} aria-label="添加事项">
      <Plus size={18} />
    </button>
    {advancedOpen && <div className="quick-advanced-panel">
      <TaskScheduleFields value={schedule} onChange={(patch) => setSchedule((current) => ({ ...current, ...patch }))} compact />
    </div>}
  </div>;
}
