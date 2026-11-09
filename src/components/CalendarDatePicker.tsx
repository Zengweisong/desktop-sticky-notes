import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { buildMonthGrid } from "../services/calendarService";
import { isValidLocalDate, localDateKey } from "../services/noteDateService";
import { useAnchoredPopover } from "../hooks/useAnchoredPopover";

interface Props {
  value: string; today?: Date; onChange: (value: string) => void;
  variant?: "compact" | "field"; label?: string; placeholder?: string;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const fullDate = new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" });

function shiftMonth(date: Date, amount: number) {
  const first = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), last));
}

export function CalendarDatePicker({ value, today = new Date(), onChange, variant = "compact", label = "选择日期", placeholder = "选择日期" }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const focusDate = useRef(false);
  const [cursor, setCursor] = useState<Date | null>(null);
  const [choosingMonth, setChoosingMonth] = useState(false);
  const open = cursor !== null;
  const dismiss = useCallback(() => setCursor(null), []);
  const { field, popup, portalRoot } = useAnchoredPopover(open, dismiss, { compact: choosingMonth });
  const activeDate = cursor ? localDateKey(cursor) : null;
  const todayKey = localDateKey(today);

  const openPicker = () => {
    focusDate.current = true;
    setChoosingMonth(false);
    setCursor(isValidLocalDate(value) ? new Date(`${value}T00:00:00`) : today);
  };
  const closePicker = (restoreFocus = false) => {
    setCursor(null);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const chooseDate = (date: string) => {
    onChange(date);
    closePicker(true);
  };

  useLayoutEffect(() => {
    if (!open || choosingMonth || !focusDate.current) return;
    focusDate.current = false;
    popup.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }, [activeDate, choosingMonth, open]);

  const navigateDate = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    const weekday = (date.getDay() + 6) % 7;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    const offset = offsets[event.key];
    let next: Date;
    if (offset !== undefined) next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    else if (event.key === "PageUp" || event.key === "PageDown") {
      next = shiftMonth(date, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1));
    } else return;
    event.preventDefault();
    if (localDateKey(next) === activeDate) return;
    focusDate.current = true;
    setCursor(next);
  };

  return <div className={`calendar-date-field ${variant === "field" ? "calendar-picker-field" : ""}`} ref={field}>
    {variant === "compact" && <input type="date" aria-label="新事项日期" value={value} onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.altKey && event.key === "ArrowDown") { event.preventDefault(); openPicker(); }
      }} />}
    <button ref={trigger} type="button" className={variant === "field" ? "picker-input" : "calendar-date-trigger"}
      aria-label={variant === "field" ? label : "打开日期选择器"}
      title="选择日期" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? closePicker(true) : openPicker()}>
      <CalendarDays size={14} />
      {variant === "field" && <span className={value ? undefined : "placeholder"}>{value ? value.replace(/-/g, "/") : placeholder}</span>}
    </button>
    {cursor && createPortal(
      <div ref={popup} id={id} className="calendar-picker-popover calendar-date-popover" role="dialog" aria-label="选择日期"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePicker(true); }
        }}>
        <div className="date-popover-header">
          <button type="button" className="date-popover-month" aria-expanded={choosingMonth}
            aria-label={choosingMonth ? "返回日期选择" : "选择月份"}
            onClick={() => setChoosingMonth(!choosingMonth)}>
            <span aria-live="polite">{cursor.getFullYear()}年{!choosingMonth && `${cursor.getMonth() + 1}月`}</span>
            <ChevronDown size={13} />
          </button>
          <div className="date-popover-nav">
            <button type="button" aria-label={choosingMonth ? "上一年" : "日期选择器：上个月"}
              onClick={() => setCursor(shiftMonth(cursor, choosingMonth ? -12 : -1))}><ChevronLeft size={16} /></button>
            <button type="button" aria-label={choosingMonth ? "下一年" : "日期选择器：下个月"}
              onClick={() => setCursor(shiftMonth(cursor, choosingMonth ? 12 : 1))}><ChevronRight size={16} /></button>
          </div>
        </div>
        {choosingMonth ? <div className="date-popover-months" aria-label="月份列表">
          {Array.from({ length: 12 }, (_, month) => <button type="button" key={month}
            aria-pressed={month === cursor.getMonth()} onClick={() => {
              focusDate.current = true;
              setCursor(shiftMonth(cursor, month - cursor.getMonth()));
              setChoosingMonth(false);
            }}>{month + 1}月</button>)}
        </div> : <>
          <div className="date-popover-weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="date-popover-days" role="group" aria-label="日期">
            {buildMonthGrid(cursor, today).map((day) => <button type="button" key={day.key}
              className={day.inMonth ? undefined : "outside-month"} tabIndex={day.key === activeDate ? 0 : -1}
              aria-label={fullDate.format(day.date)} aria-current={day.isToday ? "date" : undefined}
              aria-pressed={day.key === value} onKeyDown={(event) => navigateDate(event, day.date)}
              onClick={() => chooseDate(day.key)}>{day.date.getDate()}</button>)}
          </div>
        </>}
        <div className="calendar-picker-footer date-popover-footer">
          <button type="button" disabled={!value} onClick={() => chooseDate("")}>清除</button>
          <button type="button" className="date-popover-today" onClick={() => chooseDate(todayKey)}>今天</button>
        </div>
      </div>,
      portalRoot
    )}
  </div>;
}
