import {
  BoardColumn as BoardColumnSchema,
  ColumnContract,
  type ContractOverrides,
  type PersonaSubagentsMode,
  PersonaSubagentsMode as PersonaSubagentsModeSchema,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";
import type { BoardColumn, Project, ProjectPatch } from "../types.ts";

const PERSONA_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function subagentsMode(mode: string): PersonaSubagentsMode {
  const parsed = PersonaSubagentsModeSchema.safeParse(mode);
  if (!parsed.success) {
    throw new FlightdeckError(
      "bad_request",
      "personaSubagents must be all, project or none",
      "persona_subagents_invalid",
    );
  }
  return parsed.data;
}

/** The contracts with the patch applied: a known column, a valid contract, `null` takes one away. */
export function mergeContracts(
  current: Project["contractByColumn"],
  patch: NonNullable<ProjectPatch["contractByColumn"]>,
): Project["contractByColumn"] {
  const merged: ContractOverrides = { ...current };
  for (const [column, contract] of Object.entries(patch)) {
    if (!BoardColumnSchema.options.includes(column as BoardColumn)) {
      throw new FlightdeckError("bad_request", `unknown column: ${column}`, "column_unknown", {
        column,
      });
    }
    if (contract === null) delete merged[column as BoardColumn];
    else if (contract === undefined) continue;
    else {
      const parsed = ColumnContract.safeParse(contract);
      if (!parsed.success) {
        throw new FlightdeckError("bad_request", "invalid contract", "contract_invalid", {
          column,
        });
      }
      merged[column as BoardColumn] = parsed.data;
    }
  }
  return merged;
}

/** The default personas with the patch applied: plain ids, existing columns, `null` takes one away. */
export function mergePersonas(
  current: Project["personaByColumn"],
  patch: NonNullable<ProjectPatch["personaByColumn"]>,
): Project["personaByColumn"] {
  const merged: Record<string, string> = { ...current };
  for (const [column, id] of Object.entries(patch)) {
    if (!BoardColumnSchema.options.includes(column as BoardColumn)) {
      throw new FlightdeckError("bad_request", `unknown column: ${column}`, "column_unknown", {
        column,
      });
    }
    if (id === null) delete merged[column];
    else if (id === undefined) continue;
    else if (!PERSONA_ID.test(id))
      throw new FlightdeckError("bad_request", "invalid persona id", "persona_id_invalid");
    else merged[column] = id;
  }
  return merged;
}
