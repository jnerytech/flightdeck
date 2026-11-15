import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { byCodeUnit, inSequence, type Template, type TemplateProblem } from "@flightdeck/protocol";
import { parseTemplateFile } from "./domain/template-file.ts";

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
  // A file is named by its id, so two files cannot share one: only a built-in can hold it already.
  const builtinIds = new Set(options.builtins.map((template) => template.id));
  const names = await readdir(options.dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [] as string[];
    throw error;
  });
  await inSequence(names.filter((n) => n.endsWith(".md")).sort(byCodeUnit), async (name) => {
    try {
      const template = parseTemplateFile(
        await readFile(join(options.dir, name), "utf8"),
        name.slice(0, -3),
      );
      if (builtinIds.has(template.id)) {
        problems.push({ file: name, reason: `the id ${template.id} is a built-in template's` });
      } else {
        templates.push(template);
      }
    } catch (error) {
      problems.push({ file: name, reason: (error as Error).message });
    }
  });
  return { templates, problems };
}
