import { Check, Columns3, List, Search, Settings2, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Category } from "../types/category";
import type { NoteTimeFilter } from "../types/filter";
import type { PriorityFilter, ViewMode } from "../types/settings";

interface Props {
  categories: Category[];
  timeFilter: NoteTimeFilter;
  categoryId: number | null;
  onTimeFilterChange: (filter: NoteTimeFilter) => void;
  onCategoryChange: (categoryId: number | null) => void;
  onManage: () => void;
  search?: string;
  priority?: PriorityFilter;
  viewMode?: ViewMode;
  onSearchChange?: (value: string) => void;
  onPriorityChange?: (value: PriorityFilter) => void;
  onViewModeChange?: (value: ViewMode) => void;
}

const timeFilters: Array<{ id: NoteTimeFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "today", label: "今天" },
  { id: "overdue", label: "已过期" },
  { id: "future", label: "未来事项" },
  { id: "undated", label: "无日期" }
];

export function CategoryNav({
  categories,
  timeFilter,
  categoryId,
  onTimeFilterChange,
  onCategoryChange,
  onManage,
  search = "",
  priority = "all",
  viewMode = "list",
  onSearchChange,
  onPriorityChange,
  onViewModeChange
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const hasFilter = timeFilter !== "all" || categoryId != null || Boolean(search) || priority !== "all";
  const summary = [
    timeFilter === "all" ? null : timeFilters.find((item) => item.id === timeFilter)?.label,
    selectedCategory?.name,
    priority === "all" ? null : `${priority === "high" ? "高" : priority === "low" ? "低" : "普通"}优先级`,
    search ? `“${search}”` : null
  ].filter(Boolean).join(" · ");

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

  const clearFilters = () => {
    onTimeFilterChange("all");
    onCategoryChange(null);
    onSearchChange?.("");
    onPriorityChange?.("all");
  };

  return <nav className="category-nav" aria-label="内容工具">
    {hasFilter && <div className="active-filter-summary" title={summary}>
      <span>{summary || "已启用筛选"}</span>
      <button type="button" aria-label="清除筛选" title="清除全部筛选" onClick={clearFilters}><X size={12} /></button>
    </div>}
    <div className="content-actions">
      <div className="category-filter-picker" ref={pickerRef}>
        <button ref={triggerRef} type="button" className={`category-filter-trigger ${hasFilter ? "has-filter" : ""}`}
          aria-label="筛选事项" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}
          title="筛选事项" onClick={() => setMenuOpen((open) => !open)}>
          <SlidersHorizontal size={15} />{hasFilter && <i className="filter-active-dot" />}
        </button>
        {menuOpen && <div id={menuId} className="category-filter-popover" role="dialog" aria-label="筛选事项">
          <div className="category-filter-title">筛选事项</div>
          <label className="filter-search"><Search size={13} /><input value={search} placeholder="搜索标题或备注"
            onChange={(event) => onSearchChange?.(event.target.value)} /></label>
          <div className="filter-section-label first">时间范围</div>
          <div className="time-filter-options" role="radiogroup" aria-label="时间范围">
            {timeFilters.map(({ id, label }) => <button key={id} type="button" role="radio"
              aria-checked={timeFilter === id} className={timeFilter === id ? "selected" : ""}
              onClick={() => onTimeFilterChange(id)}>{label}</button>)}
          </div>
          <label className="priority-filter"><span>优先级</span><select value={priority}
            onChange={(event) => onPriorityChange?.(event.target.value as PriorityFilter)}>
            <option value="all">全部</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option>
          </select></label>
          <div className="filter-section-label">Tag</div>
          <button type="button" aria-pressed={categoryId == null}
            className={categoryId == null ? "selected" : ""} onClick={() => onCategoryChange(null)}>
            <i className="all-categories-dot" /><span>全部分类</span>{categoryId == null && <Check size={14} />}
          </button>
          {categories.map((category) => <button key={category.id} type="button"
            aria-pressed={category.id === categoryId} className={category.id === categoryId ? "selected" : ""}
            title={category.name} onClick={() => onCategoryChange(category.id)}>
            <i style={{ backgroundColor: category.color }} /><span>{category.name}</span>
            {category.id === categoryId && <Check size={14} />}
          </button>)}
          {hasFilter && <button type="button" className="clear-filter-link" onClick={clearFilters}>
            <X size={13} /><span>清除全部筛选</span>
          </button>}
          <button type="button" className="manage-categories-link" onClick={() => { setMenuOpen(false); onManage(); }}>
            <Settings2 size={13} /><span>管理分类</span>
          </button>
        </div>}
      </div>
      <div className="view-switch" aria-label="视图切换">
        <button type="button" className={viewMode === "list" ? "selected" : ""} aria-label="列表视图"
          aria-pressed={viewMode === "list"} title="列表视图" onClick={() => onViewModeChange?.("list")}><List size={14} /></button>
        <button type="button" className={viewMode === "board" ? "selected" : ""} aria-label="看板视图"
          aria-pressed={viewMode === "board"} title="看板视图" onClick={() => onViewModeChange?.("board")}><Columns3 size={14} /></button>
      </div>
    </div>
  </nav>;
}
