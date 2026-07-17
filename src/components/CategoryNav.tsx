import { Check, Settings2, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { countNotesByStatus } from "../services/noteFilterService";
import type { Category } from "../types/category";
import type { NoteStatusFilter } from "../types/filter";
import type { Note } from "../types/note";

interface Props {
  categories: Category[];
  notes: Note[];
  activeStatus: NoteStatusFilter;
  categoryId: number | null;
  onStatusChange: (filter: NoteStatusFilter) => void;
  onCategoryChange: (categoryId: number | null) => void;
  onManage: () => void;
}

export function CategoryNav({
  categories,
  notes,
  activeStatus,
  categoryId,
  onStatusChange,
  onCategoryChange,
  onManage
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const counts = countNotesByStatus(notes, categoryId);
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const filters: Array<{ id: NoteStatusFilter; label: string; count: number }> = [
    { id: "active", label: "未完成", count: counts.active },
    { id: "today", label: "今日", count: counts.today },
    { id: "completed", label: "已完成", count: counts.completed }
  ];

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const selectCategory = (nextCategoryId: number | null) => {
    onCategoryChange(nextCategoryId);
    setMenuOpen(false);
  };

  return <nav className="category-nav" aria-label="事项筛选">
    <div className="filter-row">
      {filters.map(({ id, label, count }) => <button key={id} type="button" aria-pressed={activeStatus === id}
        className={`filter-tab ${activeStatus === id ? "selected" : ""}`} onClick={() => onStatusChange(id)}>
        <span>{label}</span><b className={count === 0 ? "zero" : ""}>{count}</b>
      </button>)}
      <div className="category-filter-picker" ref={pickerRef}>
        <button ref={triggerRef} type="button" className={`category-filter-trigger ${categoryId != null ? "has-filter" : ""}`}
          aria-label="筛选分类" aria-haspopup="listbox" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}
          onClick={() => setMenuOpen((open) => !open)}>
          <SlidersHorizontal size={14} /><span>筛选</span>
        </button>
        {menuOpen && <div id={menuId} className="category-filter-popover" role="listbox" aria-label="分类筛选">
          <div className="category-filter-title">分类筛选</div>
          <button type="button" role="option" aria-selected={categoryId == null}
            className={categoryId == null ? "selected" : ""} onClick={() => selectCategory(null)}>
            <i className="all-categories-dot" /><span>全部分类</span>{categoryId == null && <Check size={14} />}
          </button>
          {categories.map((category) => <button key={category.id} type="button" role="option"
            aria-selected={category.id === categoryId} className={category.id === categoryId ? "selected" : ""}
            title={category.name} onClick={() => selectCategory(category.id)}>
            <i style={{ backgroundColor: category.color }} /><span>{category.name}</span>
            {category.id === categoryId && <Check size={14} />}
          </button>)}
          <button type="button" className="manage-categories-link" onClick={() => { setMenuOpen(false); onManage(); }}>
            <Settings2 size={13} /><span>管理分类</span>
          </button>
        </div>}
      </div>
    </div>
    {selectedCategory && <div className="active-category-chip">
      <span>当前分类：<strong title={selectedCategory.name}>{selectedCategory.name}</strong></span>
      <button type="button" aria-label="清除分类筛选" title="清除分类筛选" onClick={() => onCategoryChange(null)}>
        <X size={13} />
      </button>
    </div>}
  </nav>;
}
