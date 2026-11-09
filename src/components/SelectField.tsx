import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useAnchoredPopover } from "../hooks/useAnchoredPopover";

type SelectValue = string | number;

export interface SelectOption<T extends SelectValue> { value: T; label: string; }

interface Props<T extends SelectValue> {
  label: string;
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
}

export function SelectField<const T extends SelectValue>({ label, value, options, onChange }: Props<T>) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: "", at: 0 });
  const [index, setIndex] = useState<number | null>(null);
  const active = index === null || !options.length ? null : Math.min(index, options.length - 1);
  const open = active !== null;
  const selected = options.findIndex((option) => option.value === value);
  const dismiss = useCallback(() => {
    setIndex(null);
    search.current.text = "";
  }, []);
  const { field, popup, portalRoot } = useAnchoredPopover(open, dismiss, { matchAnchor: true });

  useLayoutEffect(() => {
    if (active === null) return;
    const list = popup.current;
    const option = list?.children.item(active) as HTMLElement | null;
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [active, popup]);

  const choose = (option: SelectOption<T>) => {
    dismiss();
    trigger.current?.focus({ preventScroll: true });
    if (option.value !== value) onChange(option.value);
  };

  const handleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing || !options.length) return;
    const { key } = event;
    if (key === "Tab") { dismiss(); return; }
    if (key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (active === null) setIndex(Math.max(selected, 0));
      else choose(options[active]);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const down = key === "ArrowDown";
      const start = selected >= 0 ? selected : down ? 0 : options.length - 1;
      setIndex(active === null ? start : Math.max(0, Math.min(options.length - 1, active + (down ? 1 : -1))));
      return;
    }
    if (key === "Home" || key === "End") {
      event.preventDefault();
      setIndex(key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;
    const now = Date.now();
    const letter = key.toLocaleLowerCase();
    const prefix = now - search.current.at < 600 ? search.current.text : "";
    const query = prefix === letter ? letter : prefix + letter;
    search.current = { text: query, at: now };
    const from = active ?? selected;
    for (let step = 0; step < options.length; step += 1) {
      const position = (from + (query.length === 1 ? 1 : 0) + step + options.length) % options.length;
      if (!options[position].label.toLocaleLowerCase().startsWith(query)) continue;
      event.preventDefault();
      setIndex(position);
      break;
    }
  };

  return <div ref={field} className="select-field">
    <button ref={trigger} type="button" role="combobox" className="select-field-trigger" aria-label={label}
      aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={active === null ? undefined : `${listId}-${active}`}
      disabled={!options.length} onKeyDown={handleKey}
      onClick={() => open ? dismiss() : setIndex(Math.max(selected, 0))}>
      <span>{options[selected]?.label ?? "请选择"}</span><ChevronDown size={14} />
    </button>
    {open && createPortal(
      <div ref={popup} id={listId} className="select-field-popover" role="listbox" aria-label={label}
        onPointerDown={(event) => event.stopPropagation()}>
        {options.map((option, position) => <div key={option.value} id={`${listId}-${position}`} role="option"
          aria-selected={position === selected} className={active === position ? "active" : undefined}
          onPointerMove={() => setIndex(position)} onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(option)}>
          <span>{option.label}</span>{position === selected && <Check size={14} />}
        </div>)}
      </div>,
      portalRoot
    )}
  </div>;
}
