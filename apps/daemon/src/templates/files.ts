import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Template, type TemplateProblem } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";

const bad = (message: string, reason: string) =>
  new FlightdeckError("bad_request", message, reason);

/**
 * A template as a Markdown file: the frontmatter holds everything but the prompt (JSON values are
 * valid YAML), and the body holds the prompt in a `# en` and a `# pt-BR` section.
 */
export function serializeTemplate(template: Template): string {
  const lines = [
    "---",
    `id: ${template.id}`,
    `title: ${JSON.stringify(template.title)}`,
    `description: ${JSON.stringify(template.description)}`,
    `icon: ${template.icon}`,
    `preset: ${template.preset}`,
    `planFirst: ${template.planFirst}`,
  ];
  if (template.outputFolder) lines.push(`outputFolder: ${JSON.stringify(template.outputFolder)}`);
  lines.push(`fields: ${JSON.stringify(template.fields)}`, "---");
  lines.push("# en", template.prompt.en, "", "# pt-BR", template.prompt["pt-BR"], "");
  return lines.join("\n");
}

/** The prompt of each language from the body's `# en` and `# pt-BR` sections. */
function promptsOf(body: string): { en: string; "pt-BR": string } {
  const sections: Record<string, string> = {};
  for (const part of body
    .split(/^# (en|pt-BR)[ \t]*$/m)
    .slice(1)
    .reduce<string[][]>((pairs, piece, index) => {
      if (index % 2 === 0) pairs.push([piece]);
      else pairs[pairs.length - 1]?.push(piece);
      return pairs;
    }, [])) {
    sections[part[0] as string] = (part[1] ?? "").trim();
  }
  return { en: sections.en ?? "", "pt-BR": sections["pt-BR"] ?? "" };
}

/** Reads a template file. `fileId` is the file name without `.md`: the id must be the same. */
export function parseTemplateFile(source: string, fileId?: string): Template {
  const file = source.replaceAll("\r\n", "\n");
  const end = file.indexOf("\n---", 3);
  const closes = end >= 0 && (file[end + 4] === "\n" || end + 4 === file.length);
  if (!file.startsWith("---\n") || !closes) {
    throw bad("a template starts with a frontmatter between --- lines", "template_frontmatter");
  }
  let header: unknown;
  try {
    header = Bun.YAML.parse(file.slice(4, end));
  } catch (error) {
    throw bad(`invalid frontmatter: ${(error as Error).message}`, "template_frontmatter");
  }
  if (typeof header !== "object" || header === null || Array.isArray(header)) {
    throw bad("the frontmatter must be a map", "template_frontmatter");
  }
  const parsed = Template.safeParse({ ...header, prompt: promptsOf(file.slice(end + 4)) });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw bad(
      `not a valid template: ${first?.path.join(".") || "the file"}: ${first?.message}`,
      "template_invalid",
    );
  }
  if (fileId !== undefined && parsed.data.id !== fileId) {
    throw bad(`the id (${parsed.data.id}) must be the file name (${fileId})`, "template_id_file");
  }
  return parsed.data;
}

export interface LoadedTemplates {
  templates: Template[];
  problems: TemplateProblem[];
}

/** The built-ins, then the host's own files (`<dir>/<id>.md`); a broken file is a problem, not a hole. */
export async function loadTemplates(options: {
  dir: string;
  builtins: Template[];
}): Promise<LoadedTemplates> {
  const templates = [...options.builtins];
  const problems: TemplateProblem[] = [];
  const taken = new Map(options.builtins.map((template) => [template.id, "built-in"]));
  const names = await readdir(options.dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [] as string[];
    throw error;
  });
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    try {
      const template = parseTemplateFile(
        await readFile(join(options.dir, name), "utf8"),
        name.slice(0, -3),
      );
      const owner = taken.get(template.id);
      if (owner === "built-in") {
        problems.push({ file: name, reason: `the id ${template.id} is a built-in template's` });
      } else if (owner) {
        problems.push({ file: name, reason: `the id ${template.id} is already used by ${owner}` });
      } else {
        taken.set(template.id, name);
        templates.push(template);
      }
    } catch (error) {
      problems.push({ file: name, reason: (error as Error).message });
    }
  }
  return { templates, problems };
}
