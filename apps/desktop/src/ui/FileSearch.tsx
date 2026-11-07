import { type FileSearchResult, SecretScanner } from "@flightdeck/protocol";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Stack } from "@/components/layout/stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "../lib/app-store.ts";

type Mode = "name" | "content";
/** What a search shows: none asked (the tree), on its way, its matches, or why the host refused. */
type Found = null | "searching" | FileSearchResult | { refused: string };

/** The query as the host takes it: no control characters, at most 200 characters. */
const cleaned = (query: string) =>
  query
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, 200);

/**
 * A search over the target's whole repository (#117, on #797's `file.search`): by name, the files
 * whose path holds the text, or by content, each line that holds it as `path:line`. With nothing
 * typed it shows `children` (the tree). A match opens the file through `onOpen`, at its line.
 */
export function FileSearch(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    target: string;
    onOpen(path: string, line?: number): void;
    children: ReactNode;
  }>,
) {
  const t = useT();
  const { store, hostId, target } = props;
  const [mode, setMode] = useState<Mode>("name");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found>(null);
  /** The latest search asked: an older answer that comes back later is dropped. */
  const asked = useRef(0);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const text = cleaned(query);
    const ticket = ++asked.current;
    if (text === "") {
      setFound(null);
      return;
    }
    setFound("searching");
    // Typing waits a moment, so a word is one search and not one per letter.
    const timer = setTimeout(() => {
      void store
        .hostRequest(hostId, "file.search", { target, mode, query: text })
        .then((result) => {
          if (ticket !== asked.current) return;
          setFound(
            result.ok
              ? result.data
              : { refused: refusalText(result.code, result.message, t, result) },
          );
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [store, hostId, target, mode, query, t]);

  // One field for both modes (#827): a pick changes what it searches, never the field, its text
  // or where the typing goes.
  const pickMode = (next: Mode) => {
    setMode(next);
    field.current?.focus();
  };
  const label = mode === "name" ? t("files.searchNames") : t("files.searchContent");
  return (
    <Stack gap={2}>
      <fieldset className="file-search-by">
        <legend className="sr-only">{t("files.searchBy")}</legend>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={mode === "name"}
          onClick={() => pickMode("name")}
        >
          {t("files.byName")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={mode === "content"}
          onClick={() => pickMode("content")}
        >
          {t("files.byContent")}
        </Button>
      </fieldset>
      <Input
        ref={field}
        type="search"
        aria-label={label}
        placeholder={label}
        maxLength={200}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {found === null ? (
        props.children
      ) : (
        <Matches store={store} found={found} onOpen={props.onOpen} />
      )}
    </Stack>
  );
}

/** A match as the list shows it: masked, and whether it can open. */
type Hit = {
  key: string;
  path: string;
  line: number | undefined;
  place: string;
  hidden: boolean;
  text: string | undefined;
};

/** The matches of a search, or what stands in for them. */
function Matches(
  props: Readonly<{
    store: AppStore;
    found: Exclude<Found, null>;
    onOpen(path: string, line?: number): void;
  }>,
) {
  const t = useT();
  const { store, found } = props;
  // The masker the app log uses, with what the app knows: its token shapes, the hosts' tokens
  // and the vault's values (#827). A match's line never shows any of them, nor does its path.
  const scanner = useMemo(() => new SecretScanner(() => store.scanValues()), [store]);
  // A value the app learns later (the vault loads after the app starts) renders the matches
  // again, so it hides in what is already on screen (review of #850).
  useSyncExternalStore(store.subscribeScan, () => store.scanVersion);
  // Masked on every render, not memoised: the vault's values arrive late, and a value the masker
  // learns after the answer came must still hide (security review of #827). At most 200
  // characters a line, so the cost stays small.
  const hits: Hit[] =
    typeof found === "string" || "refused" in found
      ? []
      : found.matches.map((match, index) => {
          const path = scanner.redact(match.path, false);
          // A credential, or a path with a secret in it: shown masked, never opened (the viewer
          // would name the real path), and its line is not shown.
          const hidden = match.secret === true || path !== match.path;
          const place = match.line === undefined ? path : `${path}:${match.line}`;
          return {
            // Never the real path: a duplicate-key warning would print it.
            key: `${index}:${place}`,
            path: match.path,
            line: match.line,
            place,
            hidden,
            text:
              match.text === undefined || hidden ? undefined : scanner.redact(match.text, false),
          };
        });
  if (found === "searching") {
    return <p className="text-muted-foreground text-xs">{t("files.searching")}</p>;
  }
  if ("refused" in found) {
    return (
      <p role="alert" className="text-destructive text-xs">
        {found.refused}
      </p>
    );
  }
  if (hits.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("files.nothingFound")}</p>;
  }
  return (
    <>
      <Stack as="ul" gap={1} label={t("files.results")}>
        {hits.map((hit) => (
          <li key={hit.key} className="file-hit">
            {hit.hidden ? (
              <span className="file-hit-place">
                {hit.place} <Badge variant="outline">{t("files.hidden")}</Badge>
              </span>
            ) : (
              <button
                type="button"
                className="file-hit-place file-hit-open"
                onClick={() => props.onOpen(hit.path, hit.line)}
              >
                {hit.place}
              </button>
            )}
            {hit.text !== undefined && <code className="file-hit-line">{hit.text}</code>}
          </li>
        ))}
      </Stack>
      {found.truncated && (
        <p className="text-muted-foreground text-xs">{t("files.searchTruncated")}</p>
      )}
    </>
  );
}
