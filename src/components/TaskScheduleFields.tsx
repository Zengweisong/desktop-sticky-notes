import { Bell, Repeat2 } from "lucide-react";
import type { NoteInput } from "../types/note";
import type { RepeatType } from "../types/repeat";

interface Props {
  value: NoteInput;
  onChange: (patch: Partial<NoteInput>) => void;
  compact?: boolean;
}

const OFFSETS = [
  [0, "准时提醒"], [5, "提前 5 分钟"], [10, "提前 10 分钟"], [15, "提前 15 分钟"],
  [30, "提前 30 分钟"], [60, "提前 1 小时"], [1440, "提前 1 天"]
] as const;
const WEEKDAYS = [[1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [0, "日"]] as const;

export function TaskScheduleFields({ value, onChange, compact = false }: Props) {
  const reminderEnabled = Boolean(value.reminderEnabled);
  const repeatEnabled = Boolean(value.repeatEnabled);
  const repeatType = value.repeatType || "daily";
  const interval = value.repeatInterval || 1;
  const custom = interval > 1;
  const ensureTime = () => value.scheduledAt || defaultScheduledAt();

  return <div className={`task-schedule-fields ${compact ? "compact" : ""}`}>
    <fieldset className="schedule-section">
      <legend><Bell size={13} />提醒设置</legend>
      <label className="inline-toggle"><input type="checkbox" checked={reminderEnabled}
        onChange={(event) => onChange({ reminderEnabled: event.target.checked, scheduledAt: event.target.checked ? ensureTime() : value.scheduledAt })} />
        <span>开启提醒</span></label>
      {reminderEnabled && <div className="schedule-grid">
        <label className="wide"><span>提醒所对应的事项时间</span><input type="datetime-local" step="60"
          value={toLocalDateTimeInput(value.scheduledAt)} onChange={(event) => onChange({ scheduledAt: fromLocalDateTimeInput(event.target.value) })} /></label>
        <label className="wide"><span>提前提醒时间</span><select value={value.reminderOffsetMinutes || 0}
          onChange={(event) => onChange({ reminderOffsetMinutes: Number(event.target.value) })}>
          {OFFSETS.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}
        </select></label>
      </div>}
    </fieldset>

    <fieldset className="schedule-section">
      <legend><Repeat2 size={13} />重复设置</legend>
      <label className="inline-toggle"><input type="checkbox" checked={repeatEnabled}
        onChange={(event) => onChange({ repeatEnabled: event.target.checked, scheduledAt: event.target.checked ? ensureTime() : value.scheduledAt })} />
        <span>设为重复事项</span></label>
      {repeatEnabled && <div className="schedule-grid">
        {!reminderEnabled && <label className="wide"><span>首次事项时间</span><input type="datetime-local" step="60"
          value={toLocalDateTimeInput(value.scheduledAt)} onChange={(event) => onChange({ scheduledAt: fromLocalDateTimeInput(event.target.value) })} /></label>}
        <label><span>重复规则</span><select value={custom ? "custom" : repeatType}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "custom") onChange({ repeatType: "daily", repeatInterval: 2 });
            else onChange({ repeatType: next as RepeatType, repeatInterval: 1 });
          }}>
          <option value="daily">每天</option><option value="weekdays">每个工作日</option>
          <option value="weekly">每周</option><option value="monthly">每月</option>
          <option value="yearly">每年</option><option value="custom">自定义重复</option>
        </select></label>
        {custom && <>
          <label><span>每隔</span><input type="number" min="2" max="999" value={interval}
            onChange={(event) => onChange({ repeatInterval: Math.max(2, Number(event.target.value) || 2) })} /></label>
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
          value={value.repeatMonthDay || new Date(value.scheduledAt || Date.now()).getDate()}
          onChange={(event) => onChange({ repeatMonthDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)) })} /></label>}
        <label><span>结束条件</span><select value={value.repeatEndType || "never"}
          onChange={(event) => onChange({ repeatEndType: event.target.value as NoteInput["repeatEndType"] })}>
          <option value="never">永不结束</option><option value="date">指定日期</option><option value="count">指定次数</option>
        </select></label>
        {value.repeatEndType === "date" && <label><span>结束日期</span><input type="date" value={value.repeatEndDate || ""}
          onChange={(event) => onChange({ repeatEndDate: event.target.value || null })} /></label>}
        {value.repeatEndType === "count" && <label><span>生成次数</span><input type="number" min="1" max="9999"
          value={value.repeatMaxOccurrences || 1} onChange={(event) => onChange({ repeatMaxOccurrences: Math.max(1, Number(event.target.value) || 1) })} /></label>}
        <p className="month-rule wide">每月日期不存在时，将使用当月最后一天。</p>
      </div>}
    </fieldset>
  </div>;
}

export function defaultScheduledAt() {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setSeconds(0, 0);
  return date.toISOString();
}

export function toLocalDateTimeInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}
