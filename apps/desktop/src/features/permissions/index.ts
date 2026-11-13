/**
 * The permissions' public entry in the app (#1589, #1596): answering a permission request, with the
 * hold a high-risk allow needs, the always-allow control of a request's card and the allow rules of a
 * project. Another domain imports from here, never a file inside.
 */

export type { ApprovalRequest } from "./approval-card.tsx";
export { fields, shortPath } from "./domain/approval.ts";
export { HIGH_RISK_HOLD_MS } from "./domain/hold.ts";
export { parseRequestLink, requestLink } from "./domain/request-link.ts";
export { PermissionsSlice } from "./store.ts";
export { wirePermissions } from "./wire.ts";
