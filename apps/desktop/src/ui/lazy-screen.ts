import { type ComponentType, createElement, lazy } from "react";

/** Every screen made by `lazyScreen`, so `preloadAllScreens` can load them all. */
const preloaders: Array<() => Promise<unknown>> = [];

/**
 * A screen loaded when its route opens (`React.lazy` over `import()`). After `preloadAllScreens`
 * it renders without suspending, which is what the tests use: no test has to wait for a chunk.
 */
export function lazyScreen<M extends Record<K, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
): M[K] {
  let loaded: ComponentType<object> | null = null;
  const Lazy = lazy(() =>
    load().then((m) => {
      loaded = m[name] as ComponentType<object>;
      return { default: loaded };
    }),
  );
  // biome-ignore lint/correctness/noComponentHookFactories: runs once per screen at module load, never during a render
  const Screen = (props: object) => createElement(loaded ?? Lazy, props);
  preloaders.push(async () => {
    loaded = (await load())[name] as ComponentType<object>;
  });
  return Screen as unknown as M[K];
}

/** Loads every lazy screen ahead of its route. */
export async function preloadAllScreens(): Promise<void> {
  await Promise.all(preloaders.map((preload) => preload()));
}
