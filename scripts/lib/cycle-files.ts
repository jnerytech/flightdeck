/**
 * Issue #1624: the desktop's import cycles are ratcheted by the files that sit in one, not by the
 * violation entries of dependency-cruiser: those are keyed by path and by cycle, so a move or a
 * barrel (`index.ts`) reads as a new cycle. The files in a cycle are the same before and after
 * either. The logic here is pure; `scripts/arch-report.ts` feeds it dependency-cruiser's modules.
 */

/** The part of a dependency-cruiser module this reads. */
export type CruiseModule = {
  source: string;
  dependencies: { resolved: string; dependencyTypes: string[] }[];
};

/** A pure barrel: an `index.ts` whose every import is a re-export, so it holds no code to depend on. */
const isBarrel = (module: CruiseModule): boolean =>
  /(^|\/)index\.tsx?$/.test(module.source) &&
  module.dependencies.length > 0 &&
  module.dependencies.every((dep) => dep.dependencyTypes.includes("export"));

/** The files that sit in an import cycle, sorted; a pure re-export barrel is folded into its targets. */
export function cycleFiles(modules: readonly CruiseModule[]): string[] {
  const byName = new Map(modules.map((module) => [module.source, module]));
  const barrels = new Set(modules.filter(isBarrel).map((module) => module.source));
  // What an import of `name` reaches once barrels are folded: the files its re-exports end at.
  const reach = (name: string, seen: Set<string>): string[] => {
    if (!byName.has(name)) return [];
    if (!barrels.has(name)) return [name];
    if (seen.has(name)) return [];
    seen.add(name);
    return (byName.get(name)?.dependencies ?? []).flatMap((dep) => reach(dep.resolved, seen));
  };
  const graph = new Map<string, Set<string>>();
  for (const module of modules) {
    if (barrels.has(module.source)) continue;
    const targets = new Set<string>();
    for (const dep of module.dependencies)
      for (const target of reach(dep.resolved, new Set()))
        if (target !== module.source) targets.add(target);
    graph.set(module.source, targets);
  }
  // Tarjan's strongly connected components: a component of two files or more is a cycle.
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const inCycle: string[] = [];
  const visit = (name: string): void => {
    index.set(name, index.size);
    low.set(name, index.get(name) as number);
    stack.push(name);
    onStack.add(name);
    for (const next of graph.get(name) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(name, Math.min(low.get(name) as number, low.get(next) as number));
      } else if (onStack.has(next)) {
        low.set(name, Math.min(low.get(name) as number, index.get(next) as number));
      }
    }
    if (low.get(name) !== index.get(name)) return;
    const component: string[] = [];
    for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
      onStack.delete(top);
      component.push(top);
      if (top === name) break;
    }
    if (component.length > 1) inCycle.push(...component);
  };
  for (const name of graph.keys()) if (!index.has(name)) visit(name);
  return inCycle.sort();
}
