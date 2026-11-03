import type { Template, TemplateProblem } from "@flightdeck/protocol";

/** A template as a Markdown file: the frontmatter holds the fields, a section per language the prompt. */
export function serializeTemplate(_template: Template): string {
  return "";
}

/** Reads a template file. `fileId` is the file name without `.md`: the id must be the same. */
export function parseTemplateFile(_source: string, _fileId?: string): Template {
  return {} as Template;
}

export interface LoadedTemplates {
  templates: Template[];
  problems: TemplateProblem[];
}

/** The built-ins, then the host's own files (`<dir>/<id>.md`); a broken file is a problem, not a hole. */
export async function loadTemplates(_options: {
  dir: string;
  builtins: Template[];
}): Promise<LoadedTemplates> {
  return { templates: [], problems: [] };
}
