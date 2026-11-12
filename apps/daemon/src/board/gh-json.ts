import { z } from "zod";
import { parseJsonOr, parseJsonWith } from "../kernel/index.ts";

const CheckRows = z.array(
  z.object({ name: z.string(), bucket: z.string(), link: z.string().catch("") }),
);
const PrUrl = z.object({ url: z.string() }).nullable();

/** What `gh pr checks --json name,bucket,link` printed; a check with no link reads as "". */
export const parseChecks = (stdout: string) => parseJsonWith(CheckRows, stdout);

/** What `gh pr view --json url` printed: the PR's address, or null when it has none. */
export const parsePrUrl = (stdout: string): string | null =>
  parseJsonOr(PrUrl, stdout, null)?.url ?? null;
