import { lazy, Suspense } from "react";

// react-markdown with remark and micromark is a large part of the app's code and is only needed
// once a message is drawn: it loads on demand (and `preloadMarkdown` warms it after start-up).
const loadBody = () => import("@/components/markdown/markdown-body");
const MarkdownBody = lazy(() => loadBody().then((m) => ({ default: m.MarkdownBody })));

/** Starts loading the renderer without drawing anything, so the first message is not plain text. */
export function preloadMarkdown(): void {
  void loadBody();
}

/** Assistant text: GitHub-flavored Markdown, no raw HTML (plain text while the renderer loads). */
export function Markdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap break-words text-sm">{text}</div>}>
      <MarkdownBody text={text} />
    </Suspense>
  );
}
