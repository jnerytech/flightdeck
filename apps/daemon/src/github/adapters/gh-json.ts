import { z } from "zod";
import { parseJsonOr, parseJsonWith } from "../../kernel/index.ts";

const CheckRows = z.array(
  z.object({ name: z.string(), bucket: z.string(), link: z.string().catch("") }),
);
const PrUrl = z.object({ url: z.string() }).nullable();

/** What `gh pr checks --json name,bucket,link` printed; a check with no link reads as "". */
export const parseChecks = (stdout: string) => parseJsonWith(CheckRows, stdout);

/** What `gh pr view --json url` printed: the PR's address, or null when it has none. */
export const parsePrUrl = (stdout: string): string | null =>
  parseJsonOr(PrUrl, stdout, null)?.url ?? null;

const GhCheckRow = z.object({
  conclusion: z.string().nullish(),
  state: z.string().nullish(),
  name: z.string().nullish(),
  context: z.string().nullish(),
});

/** `gh pr view --json state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt`. */
export const GhPrStatus = z.object({
  state: z.string(),
  statusCheckRollup: z.array(GhCheckRow).nullish(),
  mergeStateStatus: z.string().nullish(),
  reviewDecision: z.string().nullish(),
  createdAt: z.string().nullish(),
});

/** `gh pr view --json mergeStateStatus,reviewDecision,statusCheckRollup`, read to say why a merge was refused. */
export const GhMergeState = GhPrStatus.omit({ state: true, createdAt: true });

/** `gh pr view --json mergeable`. */
export const GhMergeable = z.object({ mergeable: z.string() });

/** The pages of `gh api --paginate --slurp .../pulls/<n>/comments`: review comments, 100 a page. */
export const GhCommentPages = z.array(
  z.array(
    z.object({
      id: z.number(),
      path: z.string(),
      line: z.number().nullish(),
      original_line: z.number().nullish(),
      user: z.object({ login: z.string() }),
      author_association: z.string().nullish(),
      body: z.string(),
    }),
  ),
);

/** `gh pr view --json reviews`. */
export const GhReviews = z.object({
  reviews: z.array(
    z.object({
      id: z.string(),
      author: z.object({ login: z.string() }),
      authorAssociation: z.string().nullish(),
      body: z.string(),
    }),
  ),
});

/** The GraphQL reply that says which review threads are resolved. */
export const GhThreads = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          nodes: z.array(
            z.object({
              isResolved: z.boolean(),
              // GraphQL's databaseId can be null: such a comment is simply never matched.
              comments: z.object({
                nodes: z.array(z.object({ databaseId: z.number().nullable() })),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});
