import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Category, CategoryDeleteStrategy } from "../types/category";

const COLORS = ["#4F87C8", "#8B6BC2", "#50A477", "#D8894B", "#D45F68", "#3F9D9A", "#8B95A5", "#D59D2A"];

interface Props {
  open: boolean;
  categories: Category[];
  onClose: () => void;
  onCreate: (name: string, color: string) => Promise<boolean>;
  onUpdate: (id: number, name: string, color: string) => Promise<boolean>;
  onMove: (id: number, direction: -1 | 1) => Promise<boolean>;
  onDelete: (id: number, strategy: CategoryDeleteStrategy) => Promise<boolean>;
  countNotes: (id: number) => Promise<number>;
}

export function CategoryManager(props: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleteCount, setDeleteCount] = useState(0);
  const [strategy, setStrategy] = useState<CategoryDeleteStrategy>({ type: "uncategorized" });
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.open || deleteTarget) return;
    closeButtonRef.current?.focus();
  }, [props.open, deleteTarget]);

  useEffect(() => {
    if (!props.open || deleteTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [props.open, props.onClose, deleteTarget]);

  useEffect(() => {
    if (!deleteTarget) return;
    void props.countNotes(deleteTarget.id).then(setDeleteCount).catch(() => setDeleteCount(0));
  }, [deleteTarget]);

  const submit = async () => {
    if (!name.trim()) return;
    const ok = editing ? await props.onUpdate(editing.id, name, color) : await props.onCreate(name, color);
    if (ok) { setName(""); setEditing(null); setColor(COLORS[0]); }
  };
  const startEdit = (category: Category) => { setEditing(category); setName(category.name); setColor(category.color); };
  const requestDelete = (category: Category) => { setDeleteCount(0); setStrategy({ type: "uncategorized" }); setDeleteTarget(category); };
  const userCategories = props.categories.filter((category) => !category.isSystem);

  return <>
    <div className={`drawer-backdrop ${props.open ? "visible" : ""}`} onClick={props.onClose} />
    <aside className={`category-manager ${props.open ? "open" : ""}`} aria-hidden={!props.open}
      role="dialog" aria-modal="true" aria-labelledby="categories-title">
      <div className="drawer-header"><div><h2 id="categories-title">类别管理</h2><p>整理你的待办事项</p></div><button ref={closeButtonRef} type="button" aria-label="关闭类别管理" onClick={props.onClose}><X size={18} /></button></div>
      <div className="category-manager-content">
        <div className="category-form">
          <input value={name} maxLength={30} placeholder={editing ? "修改类别名称" : "新类别名称"}
            onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
              if (event.key === "Escape") { setEditing(null); setName(""); }
            }} />
          <button className="category-submit" disabled={!name.trim()} onClick={() => void submit()}>{editing ? "保存" : <><Plus size={14} />新增</>}</button>
          <div className="color-picker">{COLORS.map((item) => <button key={item} aria-label={`选择颜色 ${item}`}
            className={color === item ? "selected" : ""} style={{ backgroundColor: item }} onClick={() => setColor(item)} />)}</div>
        </div>
        <div className="category-manage-list">
          {props.categories.map((category) => <div className="category-manage-row" key={category.id}>
            <i style={{ backgroundColor: category.color }} /><span title={category.name}>{category.name}</span>
            {category.isSystem ? <small>系统</small> : <div className="category-row-actions">
              <button disabled={userCategories[0]?.id === category.id} onClick={() => void props.onMove(category.id, -1)} title="上移"><ArrowUp size={14} /></button>
              <button disabled={userCategories[userCategories.length - 1]?.id === category.id} onClick={() => void props.onMove(category.id, 1)} title="下移"><ArrowDown size={14} /></button>
              <button onClick={() => startEdit(category)} title="编辑"><Pencil size={14} /></button>
              <button className="danger-text" onClick={() => requestDelete(category)} title="删除"><Trash2 size={14} /></button>
            </div>}
          </div>)}
        </div>
      </div>
    </aside>
    {deleteTarget && <div className="dialog-backdrop" onMouseDown={() => setDeleteTarget(null)}>
      <div className="confirm-dialog category-delete-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <h3>删除类别“{deleteTarget.name}”？</h3>
        {deleteCount > 0 ? <>
          <p>该类别中有 {deleteCount} 条待办，请选择处理方式。</p>
          <label><input type="radio" checked={strategy.type === "uncategorized"} onChange={() => setStrategy({ type: "uncategorized" })} />移动到“未分类”</label>
          <label><input type="radio" checked={strategy.type === "move"} onChange={() => {
            const target = props.categories.find((category) => category.id !== deleteTarget.id);
            if (target) setStrategy({ type: "move", targetCategoryId: target.id });
          }} />移动到其他类别</label>
          {strategy.type === "move" && <select value={strategy.targetCategoryId} onChange={(event) => setStrategy({ type: "move", targetCategoryId: Number(event.target.value) })}>
            {props.categories.filter((category) => category.id !== deleteTarget.id).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>}
          <label className="danger-text"><input type="radio" checked={strategy.type === "delete-notes"} onChange={() => setStrategy({ type: "delete-notes" })} />同时删除这些待办</label>
        </> : <p>该类别中没有待办，删除后无法恢复。</p>}
        <div className="dialog-actions"><button onClick={() => setDeleteTarget(null)}>取消</button><button className="danger" onClick={() => {
          void props.onDelete(deleteTarget.id, deleteCount ? strategy : { type: "uncategorized" }).then((ok) => { if (ok) setDeleteTarget(null); });
        }}>删除类别</button></div>
      </div>
    </div>}
  </>;
}
