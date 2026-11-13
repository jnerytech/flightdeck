import { z } from "zod";

/** What `az` prints for the PR provider (#1609): each reply is checked, and one that does not fit fails the call. */

/** A PR as `az repos pr create|list` prints it; only the address is read. */
export const AzPr = z.object({
  pullRequestId: z.number(),
  repository: z.object({ webUrl: z.string() }),
});
export type AzPr = z.infer<typeof AzPr>;
export const AzPrList = z.array(AzPr);

/** `az repos pr show`, for the poll. */
export const AzPrStatus = z.object({
  status: z.string(),
  mergeStatus: z.string().nullish(),
  reviewers: z
    .array(z.object({ vote: z.number().optional(), isRequired: z.boolean().optional() }))
    .nullish(),
  creationDate: z.string().nullish(),
});

/** `az repos pr show`, for the health: the merge status and the project the policies are filed under. */
export const AzPrHealth = z.object({
  mergeStatus: z.string().nullish(),
  repository: z.object({ project: z.object({ id: z.string() }) }),
});

/** `az repos pr policy list`. */
export const AzPolicies = z.array(z.object({ status: z.string() }));

/** The policy evaluations of a PR (`az devops invoke --area policy --resource evaluations`). */
export const AzEvaluations = z.object({
  value: z.array(
    z.object({
      status: z.string(),
      configuration: z.object({
        type: z.object({ displayName: z.string() }),
        settings: z.object({ displayName: z.string().nullish() }).nullish(),
      }),
      context: z.object({ buildId: z.number().nullish() }).nullish(),
    }),
  ),
});

/** The timeline of a build (`az devops invoke --area build --resource timeline`). */
export const AzTimeline = z.object({
  records: z.array(
    z.object({
      type: z.string(),
      name: z.string(),
      result: z.string().nullable(),
      log: z.object({ id: z.number() }).nullish(),
    }),
  ),
});

/** The threads of a PR (`az devops invoke --area git --resource pullRequestThreads`). */
export const AzThreads = z.object({
  value: z.array(
    z.object({
      id: z.number(),
      status: z.string().nullish(),
      isDeleted: z.boolean().nullish(),
      threadContext: z
        .object({
          filePath: z.string(),
          rightFileStart: z.object({ line: z.number() }).nullish(),
        })
        .nullish(),
      comments: z.array(
        z.object({
          id: z.number(),
          author: z.object({
            displayName: z.string(),
            uniqueName: z.string().nullish(),
            id: z.string().nullish(),
          }),
          content: z.string().nullish(),
          commentType: z.string(),
        }),
      ),
    }),
  ),
});
