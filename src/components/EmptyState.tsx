import { StickyNote } from "lucide-react";
export function EmptyState() {
  return <div className="empty-state">
    <div className="empty-icon"><StickyNote size={24} /></div>
    <strong>暂时没有事项</strong>
    <span>在上方输入内容，按 Enter 快速添加。</span>
  </div>;
}
