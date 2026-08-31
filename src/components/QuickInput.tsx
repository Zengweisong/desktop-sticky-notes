import { useEffect, useRef, useState } from "react";
import { CalendarClock, Check, ChevronDown, Plus } from "lucide-react";
import type { Category } from "../types/category";
import type { NoteInput } from "../types/note";
import { TaskScheduleFields } from "./TaskScheduleFields";
import { localDateKey, scheduledAtFromParts } from "../services/noteDateService";

interface Props {
  categories: Category[];
  categoryId: number | null;
  defaultToToday: boolean;
  minimal?: boolean;
  onCategoryChange: (id: number) => void;
  onAdd: (input: NoteInput) => Promise<boolean>;
}

export function QuickInput({ categories, categoryId, defaultToToday, minimal = false, onCategoryChange, onAdd }: Props) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [schedule, setSchedule] = useState<NoteInput>(() => initialSchedule(defaultToToday));
  const scheduleDateTouched = useRef(false);
  const currentDateKey = useRef(localDateKey(new Date()));
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
    if (scheduleDateTouched.current) return;
    const scheduledDate = defaultToToday ? localDateKey(new Date()) : null;
    setSchedule((current) => ({
      ...current,
      scheduledDate,
      scheduledTime: scheduledDate ? current.scheduledTime : null,
      scheduledAt: scheduledAtFromParts(scheduledDate, scheduledDate ? current.scheduledTime : null)
    }));
  }, [defaultToToday]);

  useEffect(() => {
    let timer = 0;
    const refreshDefaultDate = () => {
      const now = new Date();
      const nextDate = localDateKey(now);
      if (nextDate !== currentDateKey.current) {
        if (defaultToToday && !scheduleDateTouched.current) {
          setSchedule((current) => ({
            ...current,
            scheduledDate: nextDate,
            scheduledAt: scheduledAtFromParts(nextDate, current.scheduledTime)
          }));
        }
        currentDateKey.current = nextDate;
      }
      window.clearTimeout(timer);
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(refreshDefaultDate, Math.max(1_000, nextMidnight.getTime() - now.getTime() + 100));
    };
    refreshDefaultDate();
    window.addEventListener("focus", refreshDefaultDate);
    document.addEventListener("visibilitychange", refreshDefaultDate);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshDefaultDate);
      document.removeEventListener("visibilitychange", refreshDefaultDate);
    };
  }, [defaultToToday]);

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
      scheduleDateTouched.current = false;
      setSchedule(initialSchedule(defaultToToday));
      inputRef.current?.focus();
    }
    setSubmitting(false);
  };

  return <div className={`quick-input-wrap ${minimal ? "minimal" : ""} ${advancedOpen ? "advanced" : ""} ${!minimal && categoryMenuOpen ? "category-menu-open" : ""}`}>
    <div className="quick-input-row">
      <textarea
        ref={inputRef} value={value} rows={1} disabled={submitting}
        placeholder="输入事项，按 Enter 添加"
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && !composing.current) {
            event.preventDefault(); void submit();
          }
        }}
      />
      {!minimal && <div className="quick-category-picker" ref={categoryMenuRef}>
        <button className="quick-category-trigger" type="button" aria-label="选择所属类别"
          aria-haspopup="listbox" aria-expanded={categoryMenuOpen} onClick={() => setCategoryMenuOpen((open) => !open)}>
          {selectedCategory && <i style={{ backgroundColor: selectedCategory.color }} />}
          <span>{selectedCategory?.name ?? "选择类别"}</span><ChevronDown size={14} />
        </button>
        {categoryMenuOpen && <div className="quick-category-menu" role="listbox" aria-label="所属类别">
          {categories.map((category) => <button key={category.id} type="button" role="option"
            aria-selected={category.id === categoryId} className={category.id === categoryId ? "selected" : ""}
            onClick={() => { onCategoryChange(category.id); setCategoryMenuOpen(false); }}>
            <i style={{ backgroundColor: category.color }} /><span>{category.name}</span>
            {category.id === categoryId && <Check size={13} />}
          </button>)}
        </div>}
      </div>}
      <button className={`advanced-trigger icon-tooltip ${advancedOpen ? "selected" : ""}`} type="button"
        onClick={() => setAdvancedOpen((open) => !open)} aria-label="时间与重复设置" aria-expanded={advancedOpen}
        title="时间与重复设置" data-tooltip="时间与重复设置">
        <CalendarClock size={16} />
      </button>
      <button className="add-button" disabled={!value.trim() || submitting} onClick={() => void submit()} aria-label="添加事项">
        <Plus size={16} />
      </button>
    </div>
    {advancedOpen && <div className="quick-advanced-panel">
      <TaskScheduleFields value={schedule} onChange={(patch) => {
        if (Object.prototype.hasOwnProperty.call(patch, "scheduledDate")) scheduleDateTouched.current = true;
        setSchedule((current) => ({ ...current, ...patch }));
      }}
        priority={schedule.priority || "normal"}
        onPriorityChange={(priority) => setSchedule((current) => ({ ...current, priority }))} compact />
    </div>}
  </div>;
}

function initialSchedule(defaultToToday: boolean): NoteInput {
  return {
    title: "",
    priority: "normal",
    scheduledDate: defaultToToday ? localDateKey(new Date()) : null,
    scheduledTime: null,
    scheduledAt: null,
    reminderEnabled: false,
    reminderOffsetMinutes: 10,
    repeatEnabled: false,
    repeatReminderEnabled: true,
    repeatReminderTime: "09:00"
  };
}
