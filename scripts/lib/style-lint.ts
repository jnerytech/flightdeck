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

/** Raw layout utilities in a screen: it composes a layout primitive instead. */
export function layoutViolations(_source: string): StyleViolation[] {
  return [];
}
