import { useMemo, useState } from "react";
import { Bell, Clock3, Repeat2 } from "lucide-react";
import type { NoteInput, NotePriority } from "../types/note";
import type { RepeatType } from "../types/repeat";
import { scheduledAtFromParts } from "../services/noteDateService";
import { SelectField } from "./SelectField";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { CalendarTimePicker } from "./CalendarTimePicker";

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
const REMINDER_OPTIONS = [
  ...PRESET_OFFSETS.map(([minutes, label]) => ({ value: String(minutes), label })),
  { value: "custom", label: "自定义提前时间" }
];
const REPEAT_OPTIONS = [
  { value: "none", label: "不重复" }, { value: "daily", label: "每天" },
  { value: "weekdays", label: "每个工作日" }, { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" }, { value: "yearly", label: "每年" },
  { value: "custom", label: "自定义" }
] as const;
const WEEKDAYS = [[1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [0, "日"]] as const;
type OffsetUnit = "minutes" | "hours" | "days";

export function TaskScheduleFields({ value, onChange, compact = false, priority, onPriorityChange }: Props) {
  const [hint, setHint] = useState("");
  const derived = useMemo(() => planParts(value.scheduledAt), [value.scheduledAt]);
  const planDate = value.scheduledDate !== undefined ? value.scheduledDate || "" : value.planDate ?? derived.date;
  const planTime = value.scheduledTime !== undefined ? value.scheduledTime || "" : value.planTime ?? derived.time;
  const hasPlanTime = Boolean(planDate && planTime && value.scheduledAt
    && !Number.isNaN(new Date(value.scheduledAt).getTime()));
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
    const nextDate = date || null;
    const nextTime = nextDate && time ? time : null;
    const scheduledAt = buildScheduledAt(nextDate || "", nextTime || "");
    if (nextDate && nextTime && !scheduledAt) {
      setHint("所选本地时间不存在，请选择其他时间");
      return;
    }
    onChange({
      planDate: nextDate || "",
      planTime: nextTime || "",
      scheduledDate: nextDate,
      scheduledTime: nextTime,
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
    if (!hasPlanTime) { setHint("请先设置具体时间"); return; }
    setHint("");
    onChange({
      reminderEnabled: true,
      reminderOffsetMinutes: value.reminderOffsetMinutes ?? 10,
      legacyReminderAt: null
    });
  };

  const reminderOptions = <div className="reminder-options">
    <SelectField label="提醒方式" value={legacyReminder ? "legacy" : customOffset ? "custom" : String(offset)}
      options={legacyReminder ? [{ value: "legacy", label: "自定义提醒（原时间）" }, ...REMINDER_OPTIONS] : REMINDER_OPTIONS}
      onChange={(next) => {
        if (next !== "legacy") onChange({ reminderOffsetMinutes: next === "custom" ? (customOffset ? offset : 120) : Number(next), legacyReminderAt: null });
      }} />
    {customOffset && !legacyReminder && <div className="custom-offset-row"><span>提前</span><input type="number" min="1"
      max={unitMax(offsetUnit)} value={Math.max(1, Math.round(offset / unitFactor(offsetUnit)))}
      onChange={(event) => onChange({ reminderOffsetMinutes: clampInt(event.target.value, 1, unitMax(offsetUnit)) * unitFactor(offsetUnit), legacyReminderAt: null })} />
      <SelectField label="自定义提前时间单位" value={offsetUnit}
        options={[{ value: "minutes", label: "分钟" }, { value: "hours", label: "小时" }, { value: "days", label: "天" }]}
        onChange={(unit) => {
          const currentValue = Math.max(1, Math.round(offset / unitFactor(offsetUnit)));
          onChange({ reminderOffsetMinutes: Math.min(currentValue, unitMax(unit)) * unitFactor(unit), legacyReminderAt: null });
        }} /></div>}
  </div>;

  return <div className={`task-schedule-fields ${compact ? "compact" : ""}`}>
    {showPrimaryRow && <section className="schedule-primary-section" aria-label="优先级与提醒">
      <div className="schedule-primary-row">
        <div className="primary-setting priority-setting">
          <span>优先级</span>
          <SelectField label="优先级" value={priority} onChange={onPriorityChange}
            options={[{ value: "low", label: "较低" }, { value: "normal", label: "普通" }, { value: "high", label: "紧急" }]} />
        </div>
        <div className="primary-setting primary-reminder">
          <span><Bell size={18} />{repeatEnabled ? "重复提醒" : "提醒"}</span>
          <button type="button" role="switch" aria-label={repeatEnabled ? "重复提醒" : "提醒"} aria-checked={activeReminderEnabled}
            aria-disabled={!repeatEnabled && !hasPlanTime && !oneTimeReminderEnabled}
            className={`switch-control ${activeReminderEnabled ? "on" : ""} ${!repeatEnabled && !hasPlanTime && !oneTimeReminderEnabled ? "disabled" : ""}`}
            onClick={toggleReminder}><i /></button>
        </div>
      </div>
      {hint && <p className="schedule-message error primary-message" role="status">{hint}</p>}
    </section>}

    {showPrimaryRow && <div className="schedule-title"><Clock3 size={14} /><span>时间安排</span></div>}

    {!repeatEnabled && <section className="schedule-block" aria-labelledby="plan-time-label">
      <div className="schedule-label" id="plan-time-label">事项时间 <small>可选</small></div>
      <div className="plan-time-row">
        <CalendarDatePicker variant="field" value={planDate}
          onChange={(next) => patchPlan(next, planTime)} />
        <CalendarTimePicker variant="field" value={planTime}
          onChange={(next) => patchPlan(planDate || localDate(new Date()), next)} />
      </div>
    </section>}

    <section className="schedule-block repeat-block">
      <div className={`repeat-main-row ${repeatEnabled ? "active" : ""}`}>
        <div className="schedule-control-row">
          <span><Repeat2 size={13} />重复方式</span>
          <SelectField label="重复方式" value={!repeatEnabled ? "none" : customRepeat ? "custom" : repeatType}
            options={REPEAT_OPTIONS} onChange={chooseRepeat} />
        </div>
        {repeatEnabled && <div className="repeat-end-setting"><span>结束条件</span>
          <SelectField label="结束条件" value={value.repeatEndType || "never"}
            options={[{ value: "never", label: "永不结束" }, { value: "date", label: "指定日期" }, { value: "count", label: "指定次数" }]}
            onChange={(repeatEndType) => onChange({ repeatEndType })} />
        </div>}
      </div>
      {repeatEnabled && <div className="schedule-grid repeat-options">
        <div className="field-setting"><span>开始日期</span><CalendarDatePicker variant="field" value={repeatStartDate} label="重复开始日期" placeholder="重复开始日期"
          onChange={(next) => onChange({ repeatStartDate: next || localDate(new Date()) })} /></div>
        {customRepeat && <>
          <label><span>每隔</span><input type="number" min="2" max="999" value={interval}
            onChange={(event) => onChange({ repeatInterval: clampInt(event.target.value, 2, 999) })} /></label>
          <div className="field-setting"><span>单位</span>
            <SelectField label="重复单位" value={repeatType}
              options={[{ value: "daily", label: "天" }, { value: "weekly", label: "周" }, { value: "monthly", label: "月" }, { value: "yearly", label: "年" }]}
              onChange={(repeatType) => onChange({ repeatType })} />
          </div>
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
        {value.repeatEndType === "date" && <div className="field-setting"><span>结束日期</span>
          <CalendarDatePicker variant="field" label="重复结束日期" value={value.repeatEndDate || ""}
            onChange={(next) => onChange({ repeatEndDate: next || null })} /></div>}
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
          <CalendarTimePicker variant="field" value={repeatReminderTime} label="重复提醒时间"
            onChange={(next) => onChange({ repeatReminderTime: next || "09:00" })} />
        </div>}
      </div>}
    </section>

    {!repeatEnabled && !showPrimaryRow && <section className="schedule-block reminder-block">
      <div className="reminder-heading">
        <span><Bell size={13} />提醒</span>
        <button type="button" role="switch" aria-label="提醒" aria-checked={oneTimeReminderEnabled} aria-disabled={!hasPlanTime && !oneTimeReminderEnabled}
          className={`switch-control ${oneTimeReminderEnabled ? "on" : ""} ${!hasPlanTime && !oneTimeReminderEnabled ? "disabled" : ""}`}
          onClick={toggleReminder}><i /></button>
      </div>
      {!hasPlanTime && <p className="schedule-message">添加具体时间后可设置提醒</p>}
      {oneTimeReminderEnabled && reminderOptions}
      {value.legacyReminderAt && oneTimeReminderEnabled && <p className="schedule-message">旧提醒保留为自定义时间：{formatLocalDateTime(value.legacyReminderAt)}</p>}
      {hint && <p className="schedule-message error" role="status">{hint}</p>}
      {reminderExpired && <p className="schedule-message error" role="alert">提醒时间已早于当前时间，请调整计划时间或提醒时间</p>}
      {oneTimeReminderEnabled && reminderAt && !reminderExpired && !value.legacyReminderAt &&
        <p className="reminder-preview">将在 {formatLocalDateTime(reminderAt.toISOString())} 提醒</p>}
    </section>}

    {!repeatEnabled && showPrimaryRow && oneTimeReminderEnabled && <section className="schedule-block reminder-details-block" aria-label="提醒详细设置">
      <div className="reminder-details-title">提醒详细设置</div>
      {reminderOptions}
      {value.legacyReminderAt && <p className="schedule-message">旧提醒保留为自定义时间：{formatLocalDateTime(value.legacyReminderAt)}</p>}
      {reminderExpired && <p className="schedule-message error" role="alert">提醒时间已早于当前时间，请调整计划时间或提醒时间</p>}
      {reminderAt && !reminderExpired && !value.legacyReminderAt &&
        <p className="reminder-preview">将在 {formatLocalDateTime(reminderAt.toISOString())} 提醒</p>}
    </section>}
  </div>;
}

export function toLocalDateTimeInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function buildScheduledAt(date: string, time: string) {
  return scheduledAtFromParts(date, time);
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
function formatLocalDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
