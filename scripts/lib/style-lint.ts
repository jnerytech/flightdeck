/** One inline style or color class that escapes the design tokens. */
export interface StyleViolation {
  line: number;
  text: string;
  reason: string;
}

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PREFIXES =
  "bg|text|border|ring|fill|stroke|from|via|to|outline|divide|placeholder|caret|accent|shadow|decoration";
/** Tailwind's own palette (`bg-red-500`, `text-white`) or an arbitrary color (`text-[#f00]`). */
const COLOR_CLASS = new RegExp(
  String.raw`(?<![\w-])(?:${PREFIXES})-(?:(?:${PALETTE})-\d{2,3}|white|black|\[(?:#|rgb|hsl|oklch)[^\]]*\])(?![\w-])`,
  "g",
);
/** A color written in an SVG or HTML attribute. */
const COLOR_ATTRIBUTE = /\b(?:fill|stroke|color)="#[\da-fA-F]{3,8}"/g;
const NUMBER = String.raw`\d+(?:\.\d+)?`;
const UNIT = "(?:px|rem|em|%|vh|vw)";
/** `key: 240` or `key: "12px"` inside `style={{ … }}`; custom properties (`--x`) are fine. */
const MEASURE = new RegExp(`\\b[A-Za-z]\\w*\\s*:\\s*(?:${NUMBER}|(["'])${NUMBER}${UNIT}\\1)`, "g");

/** Inline styles with fixed measures and color classes outside the theme tokens, in a TSX source. */
export function styleViolations(source: string): StyleViolation[] {
  const violations: StyleViolation[] = [];
  source.split("\n").forEach((text, i) => {
    const line = i + 1;
    for (const style of text.matchAll(/style=\{\{(.*?)\}\}/g)) {
      for (const [measure] of (style[1] ?? "").matchAll(MEASURE)) {
        violations.push({ line, text: measure, reason: "medida fixa em style" });
      }
    }
    for (const [color] of text.matchAll(COLOR_CLASS)) {
      violations.push({ line, text: color, reason: "cor fora dos tokens" });
    }
    for (const [color] of text.matchAll(COLOR_ATTRIBUTE)) {
      violations.push({ line, text: color, reason: "cor fora dos tokens" });
    }
  });
  return violations;
}

const LAYOUT_REASON = "raw layout utility: compose a layout primitive";
const CLASS_CHAR = String.raw`[^\s"'\`]`;
/** A variant prefix (`sm:`, `@2xl:`, `hover:`, `[&_x]:`), kept in what is reported. */
const VARIANTS = String.raw`(?:[\w@\[\]&>*=.-]+:)*`;
/** `flex`, `grid`, and the gap, spacing and size families. */
const LAYOUT_UTILITY = `(?:(?:inline-)?(?:flex|grid)|grid-(?:cols|rows)-${CLASS_CHAR}+|gap(?:-[xy])?-${CLASS_CHAR}+|space-[xy]-${CLASS_CHAR}+|-?[pm][xytblrse]?-${CLASS_CHAR}+|(?:min-|max-)?[wh]-${CLASS_CHAR}+)`;
/** A whole class name: the characters around it are not part of a class. */
const LAYOUT_CLASS = new RegExp(
  `(?<!${CLASS_CHAR})(${VARIANTS}${LAYOUT_UTILITY})(?!${CLASS_CHAR})`,
  "g",
);
/** What a screen may still say itself: full size, the zero minimum and auto margins. */
const ALLOWED_LAYOUT = /^(?:[wh]-full|min-[wh]-0|m[xytblrse]?-auto)$/;

/** Raw layout utilities in a screen: it composes a layout primitive instead. */
export function layoutViolations(source: string): StyleViolation[] {
  const violations: StyleViolation[] = [];
  source.split("\n").forEach((text, i) => {
    if (/^\s*(?:\/\/|\/\*|\*)/.test(text)) return;
    for (const [, hit = ""] of text.matchAll(LAYOUT_CLASS)) {
      if (ALLOWED_LAYOUT.test(hit.replace(/^.*:/, ""))) continue;
      violations.push({ line: i + 1, text: hit, reason: LAYOUT_REASON });
    }
  });
  return violations;
}
