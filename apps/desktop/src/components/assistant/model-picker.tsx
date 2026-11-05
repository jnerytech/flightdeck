import type { ModelOption } from "@flightdeck/protocol";
import { type KeyboardEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { T } from "@/i18n/index";

export interface ModelPickerProps {
  t: T;
  label: string;
  defaultLabel: string;
  /** null while the list is loading. */
  options: ModelOption[] | null;
  /** The chosen model id; null is the provider's own default. */
  value: string | null;
  onChange(id: string | null): void;
  error?: string;
  onRetry?(): void;
  /** Shown only when the chosen model takes an effort. */
  effort?: { label: string; levels: string[]; value: string; onChange(level: string): void };
}

/** One row of the list: the default, or a model. */
type Row = { id: string | null; text: string; option?: ModelOption };

const matches = (option: ModelOption, query: string) =>
  `${option.label} ${option.id}`.toLowerCase().includes(query);

/**
 * The models of a provider in one searchable list, grouped by the provider's own grouping (the
 * model line, the vendor), with a first row for "the provider's default". A filter field drives it
 * from the keyboard: arrows, Home, End, Enter, Esc.
 */
export function ModelPicker(props: ModelPickerProps) {
  const { t, options, value } = props;
  const base = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const needle = query.trim().toLowerCase();

  if (options === null) {
    return <p role="status">{t("modelPicker.loading")}</p>;
  }
  if (props.error !== undefined) {
    return (
      <div role="alert" className="flex items-center gap-2 text-sm">
        <span>{t("modelPicker.failed")}</span>
        {props.onRetry && (
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            {t("modelPicker.retry")}
          </Button>
        )}
      </div>
    );
  }

  const shown = needle ? options.filter((option) => matches(option, needle)) : options;
  const rows: Row[] = [
    ...(needle ? [] : [{ id: null, text: props.defaultLabel }]),
    ...shown.map((option) => ({ id: option.id, text: option.label, option })),
  ];
  const groups: Array<{ name: string | null; rows: Array<{ row: Row; index: number }> }> = [];
  rows.forEach((row, index) => {
    const name = row.option?.group ?? null;
    const last = groups.at(-1);
    if (last && last.name === name && name !== null) last.rows.push({ row, index });
    else groups.push({ name, rows: [{ row, index }] });
  });
  const idOf = (index: number) => `${base}-option-${index}`;
  const chosen = options.find((option) => option.id === value);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = rows.length - 1;
    if (event.key === "ArrowDown") setActive(active >= last ? 0 : active + 1);
    else if (event.key === "ArrowUp") setActive(active <= 0 ? last : active - 1);
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter" && rows[active]) props.onChange(rows[active].id);
    else if (event.key === "Escape") setQuery("");
    else return;
    event.preventDefault();
  };

  return (
    <div className="flex flex-col gap-2">
      <Input
        role="combobox"
        aria-label={props.label}
        aria-expanded={true}
        aria-controls={`${base}-list`}
        aria-autocomplete="list"
        {...(rows[active] ? { "aria-activedescendant": idOf(active) } : {})}
        value={query}
        placeholder={t("modelPicker.search")}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("modelPicker.none")}</p>
      ) : (
        <div
          id={`${base}-list`}
          role="listbox"
          aria-label={props.label}
          className="max-h-56 overflow-y-auto rounded-md border"
        >
          {groups.map((group) => {
            const items = group.rows.map(({ row, index }) => (
              <div
                key={row.id ?? "default"}
                id={idOf(index)}
                role="option"
                aria-selected={row.id === value}
                tabIndex={-1}
                className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-accent ${index === active ? "bg-accent" : ""}`}
                onClick={() => props.onChange(row.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") props.onChange(row.id);
                }}
              >
                {row.text}
                {row.option?.promptPerMTok !== undefined &&
                  row.option.completionPerMTok !== undefined && (
                    <span className="block text-muted-foreground text-xs">
                      {t("modelPicker.perMillion", {
                        prompt: `$${row.option.promptPerMTok}`,
                        completion: `$${row.option.completionPerMTok}`,
                      })}
                    </span>
                  )}
              </div>
            ));
            return group.name === null ? (
              items
            ) : (
              // biome-ignore lint/a11y/useSemanticElements: a listbox holds options and role=group, not a fieldset
              <div key={group.name} role="group" aria-label={group.name}>
                <p
                  aria-hidden="true"
                  className="px-3 pt-2 font-medium text-muted-foreground text-xs"
                >
                  {group.name}
                </p>
                {items}
              </div>
            );
          })}
        </div>
      )}
      {props.effort && chosen?.supportsEffort && (
        <label className="flex items-center gap-2 text-sm">
          {props.effort.label}
          <select
            className="rounded-md border bg-background px-2 py-1"
            value={props.effort.value}
            onChange={(e) => props.effort?.onChange(e.target.value)}
          >
            {props.effort.levels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
