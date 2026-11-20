/** Issue #3460: what `flightdeckd roi` says, as pure rules over the daemon's answer. */
import type { RoiSummaryResult } from "@flightdeck/protocol";

const usd = (amount: number) => `$${amount.toFixed(2)}`;

/** The two periods, then for each project its cost, cards, merged PRs and estimated hours. */
export function roiLines(result: RoiSummaryResult): string[] {
  return [
    `${result.from} to ${result.to}, against ${result.previousFrom} to ${result.previousTo}`,
    ...(result.projects.length === 0
      ? ["no project in that time"]
      : result.projects.flatMap(({ name, projectKey, current, previous }) => [
          `${name} (${projectKey})`,
          `  cost  ${usd(current.costUsd)}  (before ${usd(previous.costUsd)})`,
          `  cards  ${current.cards}  (before ${previous.cards})`,
          `  PRs merged  ${current.prsMerged}`,
          `  hours  ${current.hours}, ${current.cardsWithoutEstimate} cards without an estimate`,
        ])),
  ];
}
