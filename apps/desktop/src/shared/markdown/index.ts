// Public entry of the Markdown renderer. `markdown-body.tsx` (react-markdown, remark) is NOT
// exported here: `markdown.tsx` loads it on demand, so importing this entry never pulls it in.
export { Markdown, preloadMarkdown } from "./markdown.tsx";
