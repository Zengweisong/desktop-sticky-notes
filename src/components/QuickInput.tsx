import { useEffect, useRef, useState } from "react";
import { CalendarClock, Plus } from "lucide-react";
import type { NoteInput } from "../types/note";
import { TaskScheduleFields } from "./TaskScheduleFields";
import { localDateKey, scheduledAtFromParts } from "../services/noteDateService";

interface Props {
  categoryId: number | null;
  defaultToToday: boolean;
  defaultDate?: string | null;
  minimal?: boolean;
  onAdd: (input: NoteInput) => Promise<boolean>;
}

export function QuickInput({ categoryId, defaultToToday, defaultDate, minimal = false, onAdd }: Props) {
  const defaultScheduledDate = defaultDate !== undefined ? defaultDate : defaultToToday ? localDateKey(new Date()) : null;
  const currentDefaultDate = useRef(defaultScheduledDate);
  currentDefaultDate.current = defaultScheduledDate;
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [schedule, setSchedule] = useState<NoteInput>(() => initialSchedule(defaultScheduledDate));
  const scheduleDateTouched = useRef(false);
  const currentDateKey = useRef(localDateKey(new Date()));
  const composing = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!advancedOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) setAdvancedOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [advancedOpen]);

  useEffect(() => {
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select(); };
    window.addEventListener("focus-quick-input", focus);
    return () => window.removeEventListener("focus-quick-input", focus);
  }, []);

  useEffect(() => {
    if (scheduleDateTouched.current) return;
    const scheduledDate = defaultScheduledDate;
    setSchedule((current) => ({
      ...current,
      scheduledDate,
      scheduledTime: scheduledDate ? current.scheduledTime : null,
      scheduledAt: scheduledAtFromParts(scheduledDate, scheduledDate ? current.scheduledTime : null)
    }));
  }, [defaultScheduledDate]);

  useEffect(() => {
    let timer = 0;
    const refreshDefaultDate = () => {
      const now = new Date();
      const nextDate = localDateKey(now);
      if (nextDate !== currentDateKey.current) {
        if (defaultDate === undefined && defaultToToday && !scheduleDateTouched.current) {
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
  }, [defaultToToday, defaultDate]);

  const submit = async () => {
    if (!value.trim() || submitting || composing.current) return;
    setSubmitting(true);
    const ok = await onAdd({ ...schedule, title: value, categoryId });
    if (ok) {
      setValue(""); setAdvancedOpen(false);
      scheduleDateTouched.current = false;
      setSchedule(initialSchedule(currentDefaultDate.current));
      inputRef.current?.focus();
    }
    setSubmitting(false);
  };

  return <div ref={wrapperRef} className={`quick-input-wrap ${minimal ? "minimal" : ""} ${advancedOpen ? "advanced" : ""}`}>
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

function initialSchedule(scheduledDate: string | null): NoteInput {
  return {
    title: "",
    priority: "normal",
    scheduledDate,
    scheduledTime: null,
    scheduledAt: null,
    reminderEnabled: false,
    reminderOffsetMinutes: 10,
    repeatEnabled: false,
    repeatReminderEnabled: true,
    repeatReminderTime: "09:00"
  };
}
