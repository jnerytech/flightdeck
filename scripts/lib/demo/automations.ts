/**
 * Issue #3858: the automations the demo seeds in its first project, so the Automations prints have
 * a list, a history and a turn-on confirmation to show. The one that is on fires from no clock and
 * no search (failing checks: the demo's PR has a passing build), so it adds no run during the prints.
 * A run carries the codes the daemon stores beside its English text (#4185), so the pt-BR print reads in Portuguese;
 * the failed one has no detail code, as a real failure has none: its message stays as the host wrote it.
 */
import type { Automation, AutomationRun } from "@flightdeck/protocol";

type Params = Record<string, string | number>;

/** One firing kept in the history of a seeded automation. */
interface DemoAutomationRun {
  firedAt: string;
  cause: string;
  causeCode: string;
  causeParams: Params;
  status: AutomationRun["status"];
  detail: string | null;
  detailCode: string | null;
  detailParams: Params | null;
}

/** What `automation.save` takes, whether to turn it on afterwards, and the firings its history shows. */
interface DemoAutomation {
  name: string;
  trigger: Automation["trigger"];
  action: Automation["action"];
  allowExternalAuthors: boolean;
  enabled: boolean;
  runs: DemoAutomationRun[];
}

/** The automation whose History the print opens. */
export const DEMO_HISTORY_AUTOMATION = "Corrigir checks do PR";
/** An automation that is off: the print turns it on, and the confirmation names it. */
export const DEMO_OFF_AUTOMATION = "Revisão da manhã";

export const DEMO_AUTOMATIONS: readonly DemoAutomation[] = [
  {
    name: DEMO_HISTORY_AUTOMATION,
    trigger: { type: "ci_failed" },
    action: { type: "send_to_card" },
    allowExternalAuthors: false,
    enabled: true,
    runs: [
      {
        firedAt: "2026-11-18T14:02:11.000Z",
        cause: "checks of the PR of card 01DEMO1 failed",
        causeCode: "ci_failed",
        causeParams: { card: "01DEMO1" },
        status: "ok",
        detail: null,
        detailCode: null,
        detailParams: null,
      },
      {
        firedAt: "2026-11-19T09:40:03.000Z",
        cause: "checks of the PR of card 01DEMO2 failed",
        causeCode: "ci_failed",
        causeParams: { card: "01DEMO2" },
        status: "failed",
        detail: "the card has no session to send to",
        detailCode: null,
        detailParams: null,
      },
      {
        firedAt: "2026-11-20T16:15:47.000Z",
        cause: "checks of the PR of card 01DEMO1 failed",
        causeCode: "ci_failed",
        causeParams: { card: "01DEMO1" },
        status: "limited",
        detail: "limit of 10 runs per day",
        detailCode: "daily_limit",
        detailParams: { max: 10 },
      },
    ],
  },
  {
    name: DEMO_OFF_AUTOMATION,
    trigger: { type: "cron", expr: "0 9 * * 1-5", tz: "America/Sao_Paulo" },
    action: { type: "start_workflow", workflow: "feature" },
    allowExternalAuthors: false,
    enabled: false,
    runs: [],
  },
  {
    name: "Triagem de bugs",
    trigger: { type: "issue_label", label: "bug" },
    action: { type: "create_card" },
    allowExternalAuthors: true,
    enabled: false,
    runs: [],
  },
];
