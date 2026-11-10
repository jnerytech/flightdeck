# The app's store splits into one slice per domain over a core port (issue #1596)

## Context

`apps/desktop/src/lib/app-store.ts` was 5649 lines: one `AppStore` class of about 212 methods over
one flat `AppState` of about 100 fields, changed through `update(patch)`. `update` has side effects
that cross domains (the hosts or the external requests remember the waiting items, the hosts or the
UI choices sync the tray, the secrets refresh the vault's values), and `useStoreState` relies on one
state object: it skips a render when only `sessions` changed. The rules of #1589 ask for the store
as one slice per domain under `features/<domain>/`.

## Decision

- A domain's slice lives in `apps/desktop/src/features/<domain>/store.ts`, named after the domain in
  `docs/GLOSSARY.md` (the daemon's folder name), behind the domain's `index.ts`. It holds:
  - its part of the state, as a type (`HistorySliceState`) and its initial values
    (`initialHistoryState`; a function returning a fresh object when the state holds arrays or
    objects, `initialActivityState()`, so no two stores share them);
  - a narrow port of what it reads and writes through the store (`HistoryCore`: `state()`,
    `update(patch)`, and only the host calls and options it needs, an option as a getter so it is
    read when used, as before);
  - a class with its actions (`HistorySlice`), and the helpers and types only it uses.
- `AppState` extends each slice's state type, so it stays one flat object: `update`, its
  side effects and `useStoreState` do not change. The initial state spreads each slice's initial
  values.
- `AppStore` is the composition root: it builds each slice with a core over its own state, `update`
  and connections, and exposes it as a read-only field named after the domain (`store.history`).
  Callers move to the slice (`store.history.openSearch()`) in the same PR as the slice, so no
  delegating method stays behind.
- One domain per PR, structure only; the component tests and the e2e journeys are the safety net.

## Discarded

- **One store per domain, each with its own subscribe.** Finer renders, but `update`'s
  cross-domain side effects would become wiring between stores, a behavior risk in every move.
- **A store library (zustand slices).** A new dependency and a rewrite, not a strangler-fig step.
- **Delegating methods on `AppStore`** kept for the callers. The facade would keep the file's size
  and every method twice.

## Consequences

- A slice reads another domain's state only through its core's `state()`, never through another
  slice's internals; a cross-domain need shows up in the port's type.
- A slice's state keys share `AppState` with every other slice's: a key a slice adds is named after
  its domain, a key that moves keeps its name (its readers do not change), and every slice's PR
  checks that no key is declared twice (a clash would merge silently).
- A domain's pure view logic moves into its feature with its slice (`awayView`, `features/activity`).
- The history's global search is the first slice. `app-store.ts` reaches its goal (it only composes the
  slices and owns the shared side effects, under 300 lines) once every domain has moved.
