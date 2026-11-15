import { z } from "zod";

/** Active work items assigned to you, with the fields an issue needs. */
export const AZURE_DEFAULT_WIQL =
  "SELECT [System.Id], [System.Title], [System.Description], [System.CreatedBy], " +
  "[System.CreatedDate], [System.Tags] FROM WorkItems WHERE [System.AssignedTo] = @Me " +
  "AND [System.State] NOT IN ('Closed','Done','Removed') AND [System.TeamProject] = @project " +
  "ORDER BY [System.ChangedDate] DESC";

export interface AzIdentity {
  displayName?: string;
  uniqueName?: string;
}

/** One work item as `az boards query|work-item show` prints it; the fields are read one by one. */
export const AzWorkItemRow = z.object({
  id: z.number(),
  fields: z.record(z.string(), z.unknown()),
});
export type AzWorkItem = z.infer<typeof AzWorkItemRow>;

/** The text of a field: a string as it is; anything else, which Azure DevOps does not send, is empty. */
export const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

/** `html` without its tags: each `<` up to the next `>`; a `<` with no `>` after it stays. A scan, not a pattern, so a long description cannot make it slow. */
function withoutTags(html: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = html.indexOf("<", at);
    const close = open === -1 ? -1 : html.indexOf(">", open);
    if (close === -1) return out + html.slice(at);
    out += html.slice(at, open);
    at = close + 1;
  }
}

/** The text of the HTML Azure DevOps keeps in descriptions. */
export function htmlToText(html: string): string {
  return withoutTags(html.replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n"))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .trim();
}
