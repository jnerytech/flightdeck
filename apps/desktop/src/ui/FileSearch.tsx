import { type FileSearchResult, SecretScanner } from "@flightdeck/protocol";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Stack } from "@/components/layout/stack";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "../lib/app-store.ts";

type Mode = "name" | "content";
const MODES: readonly Mode[] = ["name", "content"];
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
 * typed it shows `children` (the tree). A match opens the file through `onOpen`.
 */
export function FileSearch(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    target: string;
    onOpen(path: string): void;
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

  const label = mode === "name" ? t("files.searchNames") : t("files.searchContent");
  return (
    <Stack gap={2}>
      <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
        <TabsList aria-label={t("files.searchBy")}>
          <TabsTrigger value="name">{t("files.byName")}</TabsTrigger>
          <TabsTrigger value="content">{t("files.byContent")}</TabsTrigger>
        </TabsList>
        {MODES.map((each) => (
          <TabsContent key={each} value={each}>
            <Input
              type="search"
              aria-label={label}
              placeholder={label}
              maxLength={200}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </TabsContent>
        ))}
      </Tabs>
      {found === null ? (
        props.children
      ) : (
        <Matches store={store} found={found} onOpen={props.onOpen} />
      )}
    </Stack>
  );
}

/** The matches of a search, or what stands in for them. */
function Matches(
  props: Readonly<{ store: AppStore; found: Exclude<Found, null>; onOpen(path: string): void }>,
) {
  const t = useT();
  const { store, found } = props;
  // The masker the app log uses, with what the app knows: its token shapes, the hosts' tokens
  // and the vault's values (#827). A match's line never shows any of them.
  const scanner = useMemo(() => new SecretScanner(() => store.scanValues()), [store]);
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
  if (found.matches.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("files.nothingFound")}</p>;
  }
  return (
    <>
      <Stack as="ul" gap={1} label={t("files.results")}>
        {found.matches.map((match) => {
          const place = match.line === undefined ? match.path : `${match.path}:${match.line}`;
          return (
            <li key={place} className="file-hit">
              {match.secret ? (
                <span className="file-hit-place">
                  {place} <Badge variant="outline">{t("files.hidden")}</Badge>
                </span>
              ) : (
                <button
                  type="button"
                  className="file-hit-place file-hit-open"
                  onClick={() => props.onOpen(match.path)}
                >
                  {place}
                </button>
              )}
              {/* A credential's line is never shown; any other goes through the masker (#827). */}
              {match.text !== undefined && !match.secret && (
                <code className="file-hit-line">{scanner.redact(match.text, false)}</code>
              )}
            </li>
          );
        })}
      </Stack>
      {found.truncated && (
        <p className="text-muted-foreground text-xs">{t("files.searchTruncated")}</p>
      )}
    </>
  );
}
