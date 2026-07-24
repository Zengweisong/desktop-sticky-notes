import { useMemo, useRef, useState } from "react";
import { Bell, CalendarDays, Clock3, Repeat2 } from "lucide-react";
import type { NoteInput, NotePriority } from "../types/note";
import type { RepeatType } from "../types/repeat";

interface Props {
  value: NoteInput;
  onChange: (patch: Partial<NoteInput>) => void;
  compact?: boolean;
  priority?: NotePriority;
  onPriorityChange?: (priority: NotePriority) => void;
}

const PRESET_OFFSETS = [
  [0, "准时提醒"], [5, "提前 5 分钟"], [10, "提前 10 分钟"],
  [30, "提前 30 分钟"], [60, "提前 1 小时"], [1440, "提前 1 天"]
] as const;
const PRESET_MINUTES = new Set<number>(PRESET_OFFSETS.map(([minutes]) => minutes));
const WEEKDAYS = [[1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [0, "日"]] as const;
type OffsetUnit = "minutes" | "hours" | "days";

export function TaskScheduleFields({ value, onChange, compact = false, priority, onPriorityChange }: Props) {
  const [hint, setHint] = useState("");
  const derived = useMemo(() => planParts(value.scheduledAt), [value.scheduledAt]);
  const planDate = value.planDate ?? derived.date;
  const planTime = value.planTime ?? derived.time;
  const hasPlan = Boolean(value.scheduledAt && !Number.isNaN(new Date(value.scheduledAt).getTime()));
  const repeatEnabled = Boolean(value.repeatEnabled);
  const oneTimeReminderEnabled = Boolean(value.reminderEnabled);
  const repeatReminderEnabled = value.repeatReminderEnabled ?? repeatEnabled;
  const activeReminderEnabled = repeatEnabled ? repeatReminderEnabled : oneTimeReminderEnabled;
  const repeatReminderTime = value.repeatReminderTime || "09:00";
  const repeatStartDate = value.repeatStartDate || localDate(new Date());
  const repeatType = value.repeatType || "daily";
  const interval = value.repeatInterval || 1;
  const customRepeat = repeatEnabled && interval > 1;
  const offset = Math.max(0, Math.floor(value.reminderOffsetMinutes ?? 10));
  const legacyReminder = Boolean(value.legacyReminderAt);
  const customOffset = !PRESET_MINUTES.has(offset);
  const offsetUnit = bestOffsetUnit(offset);
  const reminderAt = legacyReminder ? new Date(value.legacyReminderAt!)
    : calculateDraftReminder(value.scheduledAt, offset);
  const reminderExpired = oneTimeReminderEnabled && reminderAt != null && reminderAt.getTime() <= Date.now();
  const showPrimaryRow = priority != null && onPriorityChange != null;

  const patchPlan = (date: string, time: string) => {
    const scheduledAt = buildScheduledAt(date, time);
    onChange({
      planDate: date,
      planTime: time,
      scheduledAt,
      reminderEnabled: scheduledAt ? value.reminderEnabled : false,
      legacyReminderAt: null
    });
    setHint("");
  };

  const chooseRepeat = (selection: string) => {
    setHint("");
    if (selection === "none") { onChange({ repeatEnabled: false }); return; }
    const repeatPatch = {
      repeatEnabled: true,
      repeatStartDate,
      repeatReminderEnabled: value.repeatReminderEnabled ?? true,
      repeatReminderTime,
      repeatEndType: value.repeatEndType || "never" as const
    };
    if (selection === "custom") onChange({ ...repeatPatch, repeatType: "daily", repeatInterval: 2 });
    else onChange({ ...repeatPatch, repeatType: selection as RepeatType, repeatInterval: 1 });
  };

  const toggleReminder = () => {
    if (repeatEnabled) {
      setHint("");
      onChange({ repeatReminderEnabled: !repeatReminderEnabled, repeatReminderTime });
      return;
    }
    if (oneTimeReminderEnabled) {
      setHint("");
      onChange({ reminderEnabled: false });
      return;
    }
    if (!hasPlan) { setHint("请先设置事项时间"); return; }
    setHint("");
    onChange({
      reminderEnabled: true,
      reminderOffsetMinutes: value.reminderOffsetMinutes ?? 10,
      legacyReminderAt: null
    });
  };

  return <div className={`task-schedule-fields ${compact ? "compact" : ""}`}>
    {showPrimaryRow && <section className="schedule-primary-section" aria-label="优先级与提醒">
      <div className="schedule-primary-row">
        <label className="primary-setting priority-setting">
          <span>优先级</span>
          <select value={priority} onChange={(event) => onPriorityChange(event.target.value as NotePriority)} aria-label="优先级">
            <option value="low">较低</option><option value="normal">普通</option><option value="high">紧急</option>
          </select>
        </label>
        <div className="primary-setting primary-reminder">
          <span><Bell size={18} />{repeatEnabled ? "重复提醒" : "提醒"}</span>
          <button type="button" role="switch" aria-label={repeatEnabled ? "重复提醒" : "提醒"} aria-checked={activeReminderEnabled}
            aria-disabled={!repeatEnabled && !hasPlan && !oneTimeReminderEnabled}
            className={`switch-control ${activeReminderEnabled ? "on" : ""} ${!repeatEnabled && !hasPlan && !oneTimeReminderEnabled ? "disabled" : ""}`}
            onClick={toggleReminder}><i /></button>
        </div>
      </div>
      {hint && <p className="schedule-message error primary-message" role="status">{hint}</p>}
    </section>}

    {showPrimaryRow && <div className="schedule-title"><Clock3 size={14} /><span>时间安排</span></div>}

    {!repeatEnabled && <section className="schedule-block" aria-labelledby="plan-time-label">
      <div className="schedule-label" id="plan-time-label">事项时间 <small>可选</small></div>
      <div className="plan-time-row">
        <PickerInput type="date" value={planDate} placeholder="选择日期" icon="date"
          onChange={(next) => patchPlan(next, planTime)} />
        <PickerInput type="time" value={planTime} placeholder="选择时间" icon="time"
          onChange={(next) => patchPlan(planDate, next)} />
      </div>
    </section>}

    <section className="schedule-block repeat-block">
      <div className={`repeat-main-row ${repeatEnabled ? "active" : ""}`}>
        <label className="schedule-control-row">
          <span><Repeat2 size={13} />重复方式</span>
          <select value={!repeatEnabled ? "none" : customRepeat ? "custom" : repeatType}
            onChange={(event) => chooseRepeat(event.target.value)}>
            <option value="none">不重复</option><option value="daily">每天</option>
            <option value="weekdays">每个工作日</option><option value="weekly">每周</option>
            <option value="monthly">每月</option><option value="yearly">每年</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        {repeatEnabled && <label className="repeat-end-setting"><span>结束条件</span><select value={value.repeatEndType || "never"}
          onChange={(event) => onChange({ repeatEndType: event.target.value as NoteInput["repeatEndType"] })}>
          <option value="never">永不结束</option><option value="date">指定日期</option><option value="count">指定次数</option>
        </select></label>}
      </div>
      {repeatEnabled && <div className="schedule-grid repeat-options">
        <div className="field-setting"><span>开始日期</span><PickerInput type="date" value={repeatStartDate} placeholder="重复开始日期" icon="date"
          onChange={(next) => onChange({ repeatStartDate: next || localDate(new Date()) })} /></div>
        {customRepeat && <>
          <label><span>每隔</span><input type="number" min="2" max="999" value={interval}
            onChange={(event) => onChange({ repeatInterval: clampInt(event.target.value, 2, 999) })} /></label>
          <label><span>单位</span><select value={repeatType} onChange={(event) => onChange({ repeatType: event.target.value as RepeatType })}>
            <option value="daily">天</option><option value="weekly">周</option>
            <option value="monthly">月</option><option value="yearly">年</option>
          </select></label>
        </>}
        {repeatType === "weekly" && <div className="weekday-picker wide" aria-label="每周重复日期">
          <span>星期</span><div>{WEEKDAYS.map(([day, name]) => {
            const selected = (value.repeatWeekdays || []).includes(day);
            return <button type="button" key={day} className={selected ? "selected" : ""} onClick={() => {
              const current = value.repeatWeekdays || [];
              onChange({ repeatWeekdays: selected ? current.filter((item) => item !== day) : [...current, day] });
            }}>{name}</button>;
          })}</div>
        </div>}
        {repeatType === "monthly" && <label><span>每月日期</span><input type="number" min="1" max="31"
          value={value.repeatMonthDay || new Date(`${repeatStartDate}T00:00:00`).getDate()}
          onChange={(event) => onChange({ repeatMonthDay: clampInt(event.target.value, 1, 31) })} /></label>}
        {value.repeatEndType === "date" && <label><span>结束日期</span><input type="date" value={value.repeatEndDate || ""}
          onChange={(event) => onChange({ repeatEndDate: event.target.value || null })} /></label>}
        {value.repeatEndType === "count" && <label><span>生成次数</span><input type="number" min="1" max="9999"
          value={value.repeatMaxOccurrences || 1} onChange={(event) => onChange({ repeatMaxOccurrences: clampInt(event.target.value, 1, 9999) })} /></label>}
        {repeatType === "monthly" && <p className="month-rule wide">当月没有该日期时，将使用当月最后一天。</p>}
      </div>}
      {repeatEnabled && <div className={`repeat-reminder-setting ${showPrimaryRow ? "time-only" : ""}`}>
        {!showPrimaryRow && <div className="reminder-heading">
          <span><Bell size={13} />重复提醒</span>
          <button type="button" role="switch" aria-label="重复提醒" aria-checked={repeatReminderEnabled}
            className={`switch-control ${repeatReminderEnabled ? "on" : ""}`} onClick={toggleReminder}><i /></button>
        </div>}
        {repeatReminderEnabled && <div className="repeat-reminder-time"><span>重复提醒时间</span>
          <PickerInput type="time" value={repeatReminderTime} placeholder="重复提醒时间" icon="time"
            onChange={(next) => onChange({ repeatReminderTime: next || "09:00" })} />
        </div>}
      </div>}
    </section>

    {!repeatEnabled && !showPrimaryRow && <section className="schedule-block reminder-block">
      <div className="reminder-heading">
        <span><Bell size={13} />提醒</span>
        <button type="button" role="switch" aria-label="提醒" aria-checked={oneTimeReminderEnabled} aria-disabled={!hasPlan && !oneTimeReminderEnabled}
          className={`switch-control ${oneTimeReminderEnabled ? "on" : ""} ${!hasPlan && !oneTimeReminderEnabled ? "disabled" : ""}`}
          onClick={toggleReminder}><i /></button>
      </div>
      {!hasPlan && <p className="schedule-message">选择事项时间后可设置提醒</p>}
      {oneTimeReminderEnabled && <div className="reminder-options">
          <select aria-label="提醒方式" value={legacyReminder ? "legacy" : customOffset ? "custom" : String(offset)} onChange={(event) => {
            const next = event.target.value;
            if (next !== "legacy") onChange({ reminderOffsetMinutes: next === "custom" ? (customOffset ? offset : 120) : Number(next), legacyReminderAt: null });
          }}>
            {legacyReminder && <option value="legacy">自定义提醒（原时间）</option>}
            {PRESET_OFFSETS.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}
            <option value="custom">自定义提前时间</option>
          </select>
          {customOffset && !legacyReminder && <div className="custom-offset-row"><span>提前</span><input type="number" min="1"
            max={unitMax(offsetUnit)} value={Math.max(1, Math.round(offset / unitFactor(offsetUnit)))}
            onChange={(event) => onChange({ reminderOffsetMinutes: clampInt(event.target.value, 1, unitMax(offsetUnit)) * unitFactor(offsetUnit), legacyReminderAt: null })} />
            <select aria-label="自定义提前时间单位" value={offsetUnit} onChange={(event) => {
              const unit = event.target.value as OffsetUnit;
              const currentValue = Math.max(1, Math.round(offset / unitFactor(offsetUnit)));
              onChange({ reminderOffsetMinutes: Math.min(currentValue, unitMax(unit)) * unitFactor(unit), legacyReminderAt: null });
            }}><option value="minutes">分钟</option><option value="hours">小时</option><option value="days">天</option></select></div>}
        </div>}
      {value.legacyReminderAt && oneTimeReminderEnabled && <p className="schedule-message">旧提醒保留为自定义时间：{formatLocalDateTime(value.legacyReminderAt)}</p>}
      {hint && <p className="schedule-message error" role="status">{hint}</p>}
      {reminderExpired && <p className="schedule-message error" role="alert">提醒时间已早于当前时间，请调整计划时间或提醒时间</p>}
      {oneTimeReminderEnabled && reminderAt && !reminderExpired && !value.legacyReminderAt &&
        <p className="reminder-preview">将在 {formatLocalDateTime(reminderAt.toISOString())} 提醒</p>}
    </section>}

    {!repeatEnabled && showPrimaryRow && oneTimeReminderEnabled && <section className="schedule-block reminder-details-block" aria-label="提醒详细设置">
      <div className="reminder-details-title">提醒详细设置</div>
      <div className="reminder-options">
        <select aria-label="提醒方式" value={legacyReminder ? "legacy" : customOffset ? "custom" : String(offset)} onChange={(event) => {
          const next = event.target.value;
          if (next !== "legacy") onChange({ reminderOffsetMinutes: next === "custom" ? (customOffset ? offset : 120) : Number(next), legacyReminderAt: null });
        }}>
          {legacyReminder && <option value="legacy">自定义提醒（原时间）</option>}
          {PRESET_OFFSETS.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}
          <option value="custom">自定义提前时间</option>
        </select>
        {customOffset && !legacyReminder && <div className="custom-offset-row"><span>提前</span><input type="number" min="1"
          max={unitMax(offsetUnit)} value={Math.max(1, Math.round(offset / unitFactor(offsetUnit)))}
          onChange={(event) => onChange({ reminderOffsetMinutes: clampInt(event.target.value, 1, unitMax(offsetUnit)) * unitFactor(offsetUnit), legacyReminderAt: null })} />
          <select aria-label="自定义提前时间单位" value={offsetUnit} onChange={(event) => {
            const unit = event.target.value as OffsetUnit;
            const currentValue = Math.max(1, Math.round(offset / unitFactor(offsetUnit)));
            onChange({ reminderOffsetMinutes: Math.min(currentValue, unitMax(unit)) * unitFactor(unit), legacyReminderAt: null });
          }}><option value="minutes">分钟</option><option value="hours">小时</option><option value="days">天</option></select></div>}
      </div>
      {value.legacyReminderAt && <p className="schedule-message">旧提醒保留为自定义时间：{formatLocalDateTime(value.legacyReminderAt)}</p>}
      {reminderExpired && <p className="schedule-message error" role="alert">提醒时间已早于当前时间，请调整计划时间或提醒时间</p>}
      {reminderAt && !reminderExpired && !value.legacyReminderAt &&
        <p className="reminder-preview">将在 {formatLocalDateTime(reminderAt.toISOString())} 提醒</p>}
    </section>}
  </div>;
}

function PickerInput({ type, value, placeholder, icon, disabled, onChange }: {
  type: "date" | "time"; value: string; placeholder: string; icon: "date" | "time";
  disabled?: boolean; onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const text = value ? (type === "date" ? formatLocalDate(value) : value) : placeholder;
  return <label className={`picker-input ${disabled ? "disabled" : ""}`} onClick={(event) => {
    const input = inputRef.current;
    if (!input || disabled || typeof input.showPicker !== "function") return;
    try {
      input.showPicker();
      event.preventDefault();
    }
    catch { input.focus(); }
  }}>
    {icon === "date" ? <CalendarDays size={13} /> : <Clock3 size={13} />}
    <span className={value ? "" : "placeholder"}>{text}</span>
    <input ref={inputRef} type={type} value={value} disabled={disabled} step={type === "time" ? 60 : undefined}
      aria-label={placeholder} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

export function toLocalDateTimeInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function buildScheduledAt(date: string, time: string) {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function planParts(value?: string | null) {
  const local = toLocalDateTimeInput(value);
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function calculateDraftReminder(plan: string | null | undefined, offset: number) {
  if (!plan) return null;
  const date = new Date(plan);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - offset * 60_000);
}

function bestOffsetUnit(minutes: number): OffsetUnit {
  if (minutes >= 1440 && minutes % 1440 === 0) return "days";
  if (minutes >= 60 && minutes % 60 === 0) return "hours";
  return "minutes";
}
function unitFactor(unit: OffsetUnit) { return unit === "days" ? 1440 : unit === "hours" ? 60 : 1; }
function unitMax(unit: OffsetUnit) { return unit === "days" ? 365 : unit === "hours" ? 8760 : 525600; }
function clampInt(value: string, min: number, max: number) { return Math.min(max, Math.max(min, Math.floor(Number(value) || min))); }
function formatLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}/${month}/${day}`;
}
function formatLocalDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
