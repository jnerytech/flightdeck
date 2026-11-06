---
paths:
  - "apps/desktop/src/**"
---

# The app's screens (apps/desktop/src)

- Text a person sees comes from the dictionaries, `apps/desktop/src/i18n/en.ts` and `pt-BR.ts`,
  always in both languages. Never a literal in a component: the `textos` tests fail on one.
- `@tauri-apps/*` is imported only in `src/platform/tauri/` (Biome `noRestrictedImports`). The
  rest of the app talks to the platform layer.
- `src/components/ui/` is vendored: no lint, and it is out of coverage. Compose it; do not change
  it to fit one screen.
- A screen composes the layout primitives. Raw layout utilities (anything but `w-full`, `h-full`,
  `min-w-0`, `min-h-0` and `m*-auto`) are counted per file by the layout ratchet
  (`apps/desktop/layout-baseline.json`), which only goes down.
- A screen reads the state through `useStoreSlice(store, keys)` and is a `memo` component. The
  `state-selectors` ratchet counts the files that still take `state: AppState` as a prop, and it
  only goes down.
- UI tests: `queryBy*` with `expect(...).not.toBeNull()` for the red, never `getBy*`; both
  languages; inside a wait, compare booleans, never `expect(element).toBeNull()`. The prints and
  the axe check run through `bun run slot -- bun run demo:shots`.
