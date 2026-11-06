import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** A host's name as a link to its page. */
export function HostChip(props: { name: string; label: string; onOpen(): void }) {
  return (
    <Button
      variant="link"
      size="sm"
      className="h-5 shrink-0 px-1 text-xs"
      aria-label={props.label}
      onClick={props.onOpen}
    >
      {props.name}
    </Button>
  );
}

/** A project's header: the fold toggle, then what the caller puts beside it (chips, counts). */
export function ProjectHeader(props: {
  name: string;
  expanded: boolean;
  toggleLabel: string;
  onToggle(): void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 text-xs">
      <Button
        variant="ghost"
        size="icon"
        className="size-6 text-muted-foreground"
        aria-expanded={props.expanded}
        aria-label={props.toggleLabel}
        onClick={props.onToggle}
      >
        {props.expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </Button>
      <Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <h3 className="shrink-0 font-semibold text-base text-foreground">{props.name}</h3>
      {props.children}
    </div>
  );
}

/** The project's numbers as a chip: the live sessions out of all of them. */
export function CountChip(props: { live: number; total: number; label: string }) {
  return (
    <output
      aria-label={props.label}
      className="rounded-full bg-muted px-2 text-muted-foreground tabular-nums"
    >
      {props.live}/{props.total}
    </output>
  );
}

/** Opens or folds every project at once. */
export function FoldAll(props: {
  expandLabel: string;
  collapseLabel: string;
  onExpand(): void;
  onCollapse(): void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={props.onExpand}>
        {props.expandLabel}
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onCollapse}>
        {props.collapseLabel}
      </Button>
    </div>
  );
}

/** One toggle per host, to show the sessions of that host only. */
export function HostFilterRow(props: {
  label: string;
  hosts: string[];
  selected: string;
  onSelect(host: string): void;
}) {
  return (
    <fieldset aria-label={props.label} className="flex flex-wrap items-center gap-1">
      {props.hosts.map((name) => (
        <Button
          key={name}
          variant="outline"
          size="sm"
          aria-pressed={props.selected === name}
          onClick={() => props.onSelect(props.selected === name ? "" : name)}
        >
          {name}
        </Button>
      ))}
    </fieldset>
  );
}
