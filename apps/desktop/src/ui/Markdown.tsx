import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Assistant text: GitHub-flavored Markdown, no raw HTML. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
