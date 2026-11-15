// Pure rules of a new library document: the template sections, the title and file name in plain ASCII, the cleaned body.
import type { KnowledgeKind } from "@flightdeck/protocol";

const SECTIONS: Record<KnowledgeKind, readonly string[]> = {
  adr: [
    "Context\n\nWhat is the problem, and what forces are at play?",
    "Decision\n\nWhat did we decide?",
    "Consequences\n\nWhat becomes easier, and what becomes harder?",
  ],
  rfc: [
    "Summary\n\nOne paragraph: what is proposed.",
    "Motivation\n\nWhy now, and for whom?",
    "Proposal\n\nThe design, in enough detail to be reviewed.",
    "Alternatives considered\n\nWhat else was weighed, and why not.",
    "Open questions\n\nWhat is still undecided.",
  ],
  prd: [
    "Problem\n\nWho has it, and what does it cost them?",
    "Goals\n\nWhat must be true when this ships.",
    "Non-goals\n\nWhat this does not try to do.",
    "Requirements\n\nThe behaviour, as a list a test can check.",
    "Success criteria\n\nHow we will know it worked.",
  ],
};

/** An ADR or an RFC is numbered in its folder; a PRD is named by its title alone. */
export const NUMBERED: ReadonlySet<KnowledgeKind> = new Set(["adr", "rfc"]);
const TITLE_MAX = 120;
const SLUG_MAX = 60;
/** The title on one line: controls, line breaks and direction marks become a space. */
export const oneLine = (title: string) =>
  title
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, " ")
    .trim()
    .slice(0, TITLE_MAX)
    .trim();

/** Lowercase ASCII words joined by `-`, accents folded; empty when nothing is left. */
export const slugOf = (title: string) =>
  title
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") // NOSONAR: oneLine cut the title to 120 characters (NFD adds a few per letter)
    .slice(0, SLUG_MAX)
    .replace(/-+$/, ""); // NOSONAR: the slug was just cut to SLUG_MAX (60) characters

/** Windows opens these names as devices whatever the extension: `nul.md` is no file. */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
export const fileSlug = (slug: string) => (DEVICE_NAME.test(slug) ? `${slug}-doc` : slug);

/** Characters a reader cannot see but a later session would read: marks, zero-width, tags. */
const INVISIBLE = /[\p{Cf}\p{Co}\p{Cn}\p{Variation_Selector}]/gu;

/** A body as plain text: line breaks as `\n`, no control or invisible character, no blank ends. */
export const cleanBody = (body: string) =>
  body
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/\p{Cc}/gu, (c) => (c === "\n" || c === "\t" ? c : ""))
    .replace(INVISIBLE, "")
    .trim();

/** The file: front matter, the heading, then the given body or the kind's template sections. */
export const textOf = (kind: KnowledgeKind, title: string, body: string) => {
  const sections = SECTIONS[kind].map((s) => `## ${s}`).join("\n\n");
  return `---\nstatus: transitional\n---\n# ${title}\n\n${body === "" ? sections : body}\n`;
};
