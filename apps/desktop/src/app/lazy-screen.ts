import { type ComponentType, createElement } from "react";

/** Every screen made by `lazyScreen`, so `preloadAllScreens` can load them all. */
const preloaders: Array<() => Promise<unknown>> = [];

/**
 * A screen loaded when its route opens (its `import()` is thrown to the nearest Suspense while it
 * loads). After `preloadAllScreens` it renders without suspending, which is what the tests use: no
 * test has to wait for a chunk. The screen is one component type from its first render to its
 * last: `React.lazy` renders its own wrapper type, and a parent that rendered after the chunk
 * arrived switched to the loaded one, which mounted the screen a second time (its dialogs and
 * state gone, #1792).
 */
export function lazyScreen<M extends Record<K, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
): M[K] {
  let loaded: ComponentType<object> | null = null;
  let pending: Promise<ComponentType<object>> | null = null;
  /** Why the import failed (a chunk that is gone after an update, or no network); wrapped so any value fits. */
  let failure: { error: unknown } | null = null;
  const start = () => {
    pending ??= load().then(
      (m) => {
        loaded = m[name] as ComponentType<object>;
        return loaded;
      },
      (error: unknown) => {
        failure = { error };
        throw error;
      },
    );
    return pending;
  };
  // Suspends (the thrown promise is what React.lazy throws too) until the chunk is in, then renders
  // the loaded component itself: the type is decided in the same render that has it, so no parent
  // render can pair a stale type with it. A failed import is thrown as the error itself, as
  // React.lazy does, so the nearest error boundary shows it, not the fallback for good.
  // biome-ignore lint/correctness/noComponentHookFactories: runs once per screen at module load, never during a render
  const Screen = (props: object) => {
    if (failure !== null) throw failure.error;
    if (loaded === null) throw start();
    return createElement(loaded, props);
  };
  preloaders.push(start);
  return Screen as unknown as M[K];
}

/** Loads every lazy screen ahead of its route. */
export async function preloadAllScreens(): Promise<void> {
  await Promise.all(preloaders.map((preload) => preload()));
}
