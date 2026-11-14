const MAX_BULLET = 300;

/** The text with each `[label](target)` link shortened to its label. */
export function withoutLinks(text: string): string {
  let out = "";
  let at = 0;
  let open = text.indexOf("[");
  while (open >= 0) {
    const close = text.indexOf("]", open + 1);
    if (close < 0) break;
    // A link is a label with something in it, `](`, a target, and the first `)`.
    if (close > open + 1 && text[close + 1] === "(") {
      const end = text.indexOf(")", close + 2);
      if (end < 0) break;
      out += text.slice(at, open) + text.slice(open + 1, close);
      at = end + 1;
      open = text.indexOf("[", at);
    } else {
      // Every `[` before this `]` ends at it: none of them starts a link.
      open = text.indexOf("[", close + 1);
    }
  }
  return out + text.slice(at);
}

/** A bullet as plain text: no bold, code or link markup, cut to a line a card can show. */
function plain(text: string): string {
  const clean = withoutLinks(text).replace(/[*_`]/g, "").trim();
  return clean.length > MAX_BULLET ? `${clean.slice(0, MAX_BULLET - 1).trimEnd()}…` : clean;
}

/** The bullets of the `## Highlights` section of a release's notes, as plain text. */
export function parseHighlights(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+highlights\s*$/i.test(line.trim()));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end < 0 ? rest : rest.slice(0, end))
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => plain(line.replace(/^\s*[-*]\s+/, "")))
    .filter((line) => line !== "");
}
