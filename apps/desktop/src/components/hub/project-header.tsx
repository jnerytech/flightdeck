import { ChevronDown, ChevronRight } from "lucide-react";
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
        size="sm"
        className="h-6 gap-1 px-1 font-medium text-muted-foreground"
        aria-expanded={props.expanded}
        aria-label={props.toggleLabel}
        onClick={props.onToggle}
      >
        {props.expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        <span aria-hidden="true">{props.name}</span>
      </Button>
      {props.children}
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
