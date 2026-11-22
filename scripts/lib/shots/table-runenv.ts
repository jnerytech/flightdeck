/**
 * Part of the print table (scripts/demo-shots.ts): the states of a card's Run environment panel
 * (#4287). The demo host has no run.yaml and must not start a process, so the run.yaml and the
 * run states are the page's own answers (wire rules, #3982).
 */
import type { DemoIds } from "../../demo-seed.ts";
import type { Shot } from "./shot.ts";

export function runenvShots(_ids: DemoIds): Shot[] {
  return [];
}
