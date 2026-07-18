import { StickyNote } from "lucide-react";
export function EmptyState() {
  return <div className="empty-state">
    <div className="empty-icon"><StickyNote size={24} /></div>
    <strong>暂无待办事项</strong>
    <span>在上方输入并按 Enter 添加</span>
  </div>;
}
