/**
 * The accessible name pattern of Costs' scope button for a project that Home showed as `label`;
 * `menu` is the dictionary's sentence for it (`scope.menu`). The label is told apart against every
 * project the app knows (#881), and a host that reports after Home was read adds a host
 * (`docs-site · alfa`) or a parent folder (`web/docs-site`) to it, so the button may carry the
 * same name with one of those added.
 */
export function projectScopeName(menu: (scope: string) => string, label: string): RegExp {
  return /^$/;
}
