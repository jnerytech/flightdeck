import type { PermissionUpdate, ToolInput } from "@flightdeck/protocol";

/** How a permission request ends: allowed (maybe with a changed input and new rules) or denied. */
export type PermissionDecision =
  | { behavior: "allow"; updatedInput?: ToolInput; updatedPermissions?: PermissionUpdate[] }
  | { behavior: "deny"; message: string };
