import type { ServerOptions } from "../server-options.ts";

/**
 * What `main.ts` sees of a daemon domain (#2094, `docs/decisions/2026-11-12-daemon-domain-modules.md`):
 * its part of `startServer`'s options, its start and its stop.
 */
export interface DomainModule<K extends keyof ServerOptions = never> {
  /** The domain's part of `startServer`'s options: its group, built with `serverGroup<K>()`. */
  server?: Pick<ServerOptions, K>;
  /** Work before the server listens. Awaited right after this module is added. */
  start?(): void | Promise<void>;
  /** Work that needs the server listening (loops that broadcast, WSL). Awaited in list order. */
  started?(): void | Promise<void>;
  /** Lets go of timers, children and handles. */
  stop?(): void | Promise<void>;
  /** When the stop runs outside reverse construction order. Default "normal". */
  stopPhase?: "first" | "normal" | "late";
}

/** A module of any domain, as the runner holds it. */
type AnyModule = Omit<DomainModule, "server"> & { server?: Partial<ServerOptions> };

/** Starts and stops the domains' modules in the order the decision record sets. */
export interface ModuleRunner {
  /** Adds a domain's modules, in construction order, and awaits each one's `start()`. Returns `built`. */
  add<T extends { modules: readonly AnyModule[] }>(built: T): Promise<T>;
  /** The `startServer` groups of every module added. */
  server(): Partial<ServerOptions>;
  /** Each module's `started()`, in list order, once the server listens. */
  started(): Promise<void>;
  /** `"first"` modules in list order, `"normal"` ones in reverse, `stopServer`, then `"late"` in reverse. */
  stop(stopServer: () => void | Promise<void>): Promise<void>;
}

export function createModuleRunner(): ModuleRunner {
  const list: AnyModule[] = [];
  const phase = (m: AnyModule) => m.stopPhase ?? "normal";
  const stopAll = async (modules: readonly AnyModule[]) => {
    for (const m of modules) await m.stop?.();
  };
  return {
    add: async (built) => {
      for (const m of built.modules) {
        list.push(m);
        await m.start?.();
      }
      return built;
    },
    server: () => Object.assign({}, ...list.map((m) => m.server ?? {})),
    started: async () => {
      for (const m of list) await m.started?.();
    },
    stop: async (stopServer) => {
      const reversed = [...list].reverse();
      await stopAll(list.filter((m) => phase(m) === "first"));
      await stopAll(reversed.filter((m) => phase(m) === "normal"));
      await stopServer();
      await stopAll(reversed.filter((m) => phase(m) === "late"));
    },
  };
}

/**
 * A domain's group of server options (#1593), checked both ways: every service of the group is
 * there, and none it does not know (a variable skips the excess-property check `satisfies` gives).
 * `K` names the option the group fills, so the wiring needs no import of the group's type;
 * `Absent`, the services a host that does not run them leaves out.
 */
export const serverGroup =
  <K extends keyof ServerOptions, Absent extends keyof Group<K> = never>() =>
  <T extends Required<Omit<Group<K>, Absent>> & Pick<Group<K>, Absent>>(
    h: T & Record<Exclude<keyof T, keyof Group<K>>, never>,
  ): Group<K> =>
    // A generic Required<X> is not provably an X to the compiler; at each call it is.
    h as unknown as Group<K>;
type Group<K extends keyof ServerOptions> = NonNullable<ServerOptions[K]>;
