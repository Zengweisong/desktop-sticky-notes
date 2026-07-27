import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
  className?: string;
}

const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer"
    onClick={(event) => event.stopPropagation()} />
};

export const MarkdownContent = memo(function MarkdownContent({ content, className = "" }: Props) {
  return <div className={`markdown-content ${className}`.trim()}>
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} skipHtml components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
  </div>;
});
