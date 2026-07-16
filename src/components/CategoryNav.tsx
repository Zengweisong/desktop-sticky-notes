import { CalendarClock, CheckCheck, Circle, ListTodo, Plus, SlidersHorizontal } from "lucide-react";
import type { Category } from "../types/category";
import type { Note } from "../types/note";
import type { NoteFilter } from "../types/filter";

interface Props {
  categories: Category[];
  notes: Note[];
  active: NoteFilter;
  onChange: (filter: NoteFilter) => void;
  onManage: () => void;
}

export function CategoryNav({ categories, notes, active, onChange, onManage }: Props) {
  const activeCount = notes.filter((note) => !note.completed).length;
  const today = localDateKey(new Date());
  const todayCount = notes.filter((note) => !note.completed && note.dueAt?.slice(0, 10) === today).length;
  const completedCount = notes.filter((note) => note.completed).length;
  const filters: Array<{ id: NoteFilter; label: string; count: number; icon: typeof ListTodo }> = [
    { id: "all", label: "全部", count: activeCount, icon: ListTodo },
    { id: "today", label: "今天", count: todayCount, icon: CalendarClock },
    { id: "active", label: "未完成", count: activeCount, icon: Circle },
    { id: "completed", label: "已完成", count: completedCount, icon: CheckCheck }
  ];
  return <nav className="category-nav" aria-label="事项筛选">
    <div className="filter-row">
      {filters.map(({ id, label, count, icon: Icon }) => <button key={id} className={active === id ? "selected" : ""} onClick={() => onChange(id)}>
        <Icon size={13} /><span>{label}</span><b>{count}</b>
      </button>)}
    </div>
    <div className="category-row">
      <div className="category-scroll">
        {categories.map((category) => {
          const filter = `category:${category.id}` as NoteFilter;
          const count = notes.filter((note) => !note.completed && note.categoryId === category.id).length;
          return <button key={category.id} title={category.name} className={active === filter ? "selected" : ""} onClick={() => onChange(filter)}>
            <i style={{ backgroundColor: category.color }} /><span>{category.name}</span><b>{count}</b>
          </button>;
        })}
      </div>
      <button className="manage-categories" onClick={onManage} title="管理类别"><SlidersHorizontal size={14} /></button>
      <button className="add-category-shortcut" onClick={onManage} title="新增类别"><Plus size={15} /></button>
    </div>
  </nav>;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
