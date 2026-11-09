import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock3 } from "lucide-react";
import { useAnchoredPopover } from "../hooks/useAnchoredPopover";
import { isValidLocalTime } from "../services/noteDateService";

interface Props {
  value: string; onChange: (value: string) => void;
  variant?: "compact" | "field"; label?: string; placeholder?: string;
}

const pad = (value: string | number) => String(value).padStart(2, "0");
const hours = Array.from({ length: 24 }, (_, index) => pad(index));
const minutes = Array.from({ length: 60 }, (_, index) => pad(index));

export function CalendarTimePicker({ value, onChange, variant = "compact", label = "选择时间", placeholder = "添加时间" }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const dismiss = useCallback(() => setOpen(false), []);
  const { field, popup, portalRoot } = useAnchoredPopover(open, dismiss);
  const time = hour ? `${pad(hour)}:${pad(minute)}` : "";
  const valid = isValidLocalTime(time);

  useLayoutEffect(() => {
    if (!open) return;
    const input = popup.current?.querySelector("input");
    input?.focus({ preventScroll: true });
    input?.select();
  }, [open, popup]);

  const closePicker = () => {
    dismiss();
    trigger.current?.focus({ preventScroll: true });
  };
  const showPicker = () => {
    const [currentHour = "", currentMinute = ""] = value.split(":");
    setHour(currentHour);
    setMinute(currentMinute);
    setOpen(true);
  };
  const commit = (value: string) => {
    onChange(value);
    closePicker();
  };

  return <div ref={field} className={`calendar-time-field ${variant === "field" ? "calendar-picker-field" : ""}`}>
    <button ref={trigger} type="button" className={variant === "field" ? "picker-input" : "calendar-time-trigger"}
      aria-label={variant === "field" ? label : value ? `新事项时间，${value}` : "新事项时间，未设置"}
      title="选择时间" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? closePicker() : showPicker()}>
      {variant === "field" && <Clock3 size={14} />}
      <span className={!value && variant === "field" ? "placeholder" : undefined}>{value || (variant === "field" ? placeholder : "时间")}</span>
      {variant === "compact" && <Clock3 size={13} />}
    </button>
    {open && createPortal(
      <div ref={popup} id={id} className="calendar-picker-popover calendar-time-popover" role="dialog" aria-label="选择时间"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePicker(); }
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            if (valid) commit(time);
          }
        }}>
        <div className="time-popover-header"><Clock3 size={16} /><strong>选择时间</strong><span>24 小时制</span></div>
        <div className="time-popover-grid">
          <TimeColumn label="小时" options={hours} value={hour} onChange={(value) => {
            setHour(value);
            if (value && !minute) setMinute("00");
          }} />
          <TimeColumn label="分钟" options={minutes} value={minute} onChange={setMinute} />
        </div>
        <div className="calendar-picker-footer">
          <button type="button" disabled={!value && !hour && !minute} onClick={() => commit("")}>清除</button>
          <button type="button" className="time-popover-confirm" disabled={!valid} onClick={() => commit(time)}>确定</button>
        </div>
      </div>,
      portalRoot
    )}
  </div>;
}

function TimeColumn({ label, options, value, onChange }: {
  label: string; options: readonly string[]; value: string; onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = value ? pad(value) : "";

  useLayoutEffect(() => {
    const column = list.current;
    const option = column?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!column || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < column.scrollTop || bottom > column.scrollTop + column.clientHeight) {
      column.scrollTop = top - (column.clientHeight - option.offsetHeight) / 2;
    }
  }, [selected]);

  return <div className="time-popover-column">
    <label><span>{label}</span><input ref={input} type="text" inputMode="numeric" maxLength={2}
      value={value} placeholder="未选" aria-invalid={Boolean(value) && !options.includes(selected)}
      onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ""))}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const index = options.indexOf(selected);
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const next = index < 0 ? 0 : (index + offset + options.length) % options.length;
        onChange(options[next]);
      }} /></label>
    <div ref={list} className="time-popover-options" role="group" aria-label={`${label}选项`}>
      {options.map((option) => <button type="button" tabIndex={-1} key={option}
        aria-label={`${option} ${label}`} aria-pressed={selected === option}
        onClick={() => { onChange(option); input.current?.focus({ preventScroll: true }); }}>{option}</button>)}
    </div>
  </div>;
}
