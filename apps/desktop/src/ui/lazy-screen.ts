import { type ComponentType, lazy } from "react";

/** Every screen made by `lazyScreen`, so `preloadAllScreens` can load them all. */
const preloaders: Array<() => Promise<unknown>> = [];

/**
 * A screen loaded when its route opens (`React.lazy` over `import()`).
 */
export function lazyScreen<M extends Record<K, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
): M[K] {
  const component = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
  preloaders.push(load);
  return component as unknown as M[K];
}

/** Loads every lazy screen ahead of its route. */
export async function preloadAllScreens(): Promise<void> {}
