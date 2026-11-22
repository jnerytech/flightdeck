/**
 * Issue #3973: the snippets the demo seeds, so the Snippets prints have a list, a use dialog with
 * fields to fill, a project's versioned file and a shell history to import from.
 */
import type { SnippetInput } from "@flightdeck/protocol";

/** A snippet of the host, and whether the seed marks it a favorite. */
export interface DemoSnippet extends SnippetInput {
  favorite: boolean;
}

/** The command whose use dialog the print opens (it has a field with a default). */
export const DEMO_USE_COMMAND = "";
/** The prompt whose Edit button the print opens. */
export const DEMO_EDIT_PROMPT = "";

export const DEMO_SNIPPETS: readonly DemoSnippet[] = [];

/** The project's versioned file: what `snippets.save` takes with `target: "file"`. */
export const DEMO_FILE_SNIPPETS: readonly SnippetInput[] = [];

/** The shell history the host reads (bash format, one command a line). */
export const DEMO_SHELL_HISTORY = "";

/** A file the import-from-a-file print picks (YAML). */
export const DEMO_IMPORT_FILE = "";
