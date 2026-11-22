/**
 * Issue #3858: the automations the demo seeds in its first project, so the Automations prints have
 * a list, a history and a turn-on confirmation to show. The one that is on fires from no clock and
 * no search (failing checks: the demo's PR has a passing build), so it adds no run during the prints.
 */
import type { Automation, AutomationRun } from "@flightdeck/protocol";

/** One firing kept in the history of a seeded automation. */
interface DemoAutomationRun {
  firedAt: string;
  cause: string;
  status: AutomationRun["status"];
  detail: string | null;
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
        status: "ok",
        detail: null,
      },
      {
        firedAt: "2026-11-19T09:40:03.000Z",
        cause: "checks of the PR of card 01DEMO2 failed",
        status: "failed",
        detail: "the card has no session to send to",
      },
      {
        firedAt: "2026-11-20T16:15:47.000Z",
        cause: "checks of the PR of card 01DEMO1 failed",
        status: "limited",
        detail: "limit of 10 runs per day",
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
