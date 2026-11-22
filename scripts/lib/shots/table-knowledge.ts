/** Part of the print table (scripts/demo-shots.ts), in print order: the Knowledge panel and the Memory tab (#4236). */
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, agentRoute, type Shot } from "./shot.ts";

export function knowledgeShots(_ids: DemoIds): Shot[] {
  return [];
}

export function memoryShots(ids: DemoIds): Shot[] {
  return [{ name: "agente-memoria-stub", route: agentRoute(ids) }];
}
void ALFA;
