import { CalendarDays, Check, Columns3, List, ListFilter, Search, Settings2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Category } from "../types/category";
import type { NoteTimeFilter } from "../types/filter";
import type { PriorityFilter, ViewMode } from "../types/settings";
import { SelectField } from "./SelectField";

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
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const showTimeFilter = viewMode !== "calendar";
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const hasFilter = (showTimeFilter && timeFilter !== "all") || categoryId != null || Boolean(search) || priority !== "all";
  const summary = [
    !showTimeFilter || timeFilter === "all" ? null : timeFilters.find((item) => item.id === timeFilter)?.label,
    selectedCategory?.name,
    priority === "all" ? null : `${priority === "high" ? "高" : priority === "low" ? "低" : "普通"}优先级`,
    search ? `“${search}”` : null
  ].filter(Boolean).join(" · ");

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const fitPanel = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const shell = pickerRef.current?.closest(".panel");
      const topBoundary = Math.max(10, (shell?.querySelector(".titlebar")?.getBoundingClientRect().bottom ?? 0) + 6);
      const bottomBoundary = Math.min(shell?.getBoundingClientRect().bottom ?? window.innerHeight, window.innerHeight) - 18;
      panel.style.setProperty("--filter-panel-height", `${Math.max(0, bottomBoundary - topBoundary)}px`);
      const anchorBottom = triggerRef.current?.getBoundingClientRect().bottom ?? topBoundary;
      const top = Math.max(topBoundary, Math.min(anchorBottom + 6, bottomBoundary - panel.offsetHeight));
      const parentTop = panel.offsetParent?.getBoundingClientRect().top ?? 0;
      panel.style.setProperty("--filter-panel-top", `${top - parentTop}px`);
    };
    fitPanel();
    window.addEventListener("resize", fitPanel);
    return () => window.removeEventListener("resize", fitPanel);
  }, [menuOpen]);

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
    if (showTimeFilter) onTimeFilterChange("all");
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
        <button ref={triggerRef} type="button" className={`category-filter-trigger icon-tooltip ${hasFilter ? "has-filter" : ""}`}
          aria-label="筛选事项" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}
          title="筛选事项" data-tooltip="筛选事项" onClick={() => setMenuOpen((open) => !open)}>
          <ListFilter size={15} />{hasFilter && <i className="filter-active-dot" />}
        </button>
        {menuOpen && <div ref={panelRef} id={menuId} className="category-filter-popover" role="dialog" aria-label="筛选事项">
          <div className="filter-panel-header">
            <div className="category-filter-title"><ListFilter size={15} />筛选事项</div>
            <button type="button" className="clear-filter-link" disabled={!hasFilter} aria-label="清除全部筛选" onClick={clearFilters}>
              <X size={12} />重置
            </button>
          </div>
          <div className="filter-panel-body">
            <label className="filter-search"><Search size={13} /><input value={search} placeholder="搜索标题或备注"
              onChange={(event) => onSearchChange?.(event.target.value)} /></label>
            {showTimeFilter && <><div className="filter-section-label">时间范围</div>
            <div className="time-filter-options" role="radiogroup" aria-label="时间范围">
              {timeFilters.map(({ id, label }) => <button key={id} type="button" role="radio"
                aria-checked={timeFilter === id} className={timeFilter === id ? "selected" : ""}
                onClick={() => onTimeFilterChange(id)}>{label}</button>)}
            </div></>}
            <div className="priority-filter"><span>优先级</span>
              <SelectField label="优先级筛选" value={priority} onChange={(next) => onPriorityChange?.(next)}
                options={[{ value: "all", label: "全部" }, { value: "high", label: "高" }, { value: "normal", label: "普通" }, { value: "low", label: "低" }]} />
            </div>
            <div className="filter-section-label filter-category-heading"><span>所属分类</span><small>新增事项沿用所选分类</small></div>
            <div className="filter-category-options" role="group" aria-label="所属分类">
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
            </div>
          </div>
          <div className="filter-panel-footer">
            <button type="button" className="manage-categories-link" onClick={() => { setMenuOpen(false); onManage(); }}>
              <Settings2 size={13} /><span>管理分类</span>
            </button>
            <button type="button" className="filter-done" onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }}>完成</button>
          </div>
        </div>}
      </div>
      <div className="view-switch" aria-label="视图切换">
        <button type="button" className={viewMode === "list" ? "selected" : ""} aria-label="列表视图"
          aria-pressed={viewMode === "list"} title="列表视图" onClick={() => onViewModeChange?.("list")}><List size={14} /></button>
        <button type="button" className={viewMode === "board" ? "selected" : ""} aria-label="看板视图"
          aria-pressed={viewMode === "board"} title="看板视图" onClick={() => onViewModeChange?.("board")}><Columns3 size={14} /></button>
        <button type="button" className={viewMode === "calendar" ? "selected" : ""} aria-label="月历视图"
          aria-pressed={viewMode === "calendar"} title="月历视图" onClick={() => onViewModeChange?.("calendar")}><CalendarDays size={14} /></button>
      </div>
    </div>
  </nav>;
}
