import { z } from "zod";

/** Personas and snippets are lists of the app's own items, each with an id. */
export const Item = z.object({ id: z.string() }).passthrough();
export type Item = z.infer<typeof Item>;

/** What a restore would do with one kind of data, by name; never a value. */
export interface KindSummary {
  added: string[];
  same: string[];
  conflicting: string[];
}

export const personaName = (item: Item) => String(item.name ?? item.id);
export const snippetName = (item: Item) =>
  String((item.def as { name?: unknown } | undefined)?.name ?? item.id);

export type Status = "added" | "same" | "conflicting";

/** Whether an item is new here, the same as what is here, or differs from it. */
export function statusOf(exists: boolean, same: boolean): Status {
  if (!exists) return "added";
  return same ? "same" : "conflicting";
}

/** One thing of the bundle, what it is called, and how it stands against this profile right now. */
export interface Judged<T> {
  id: string;
  name: string;
  status: Status;
  item: T;
}

export const judgeItems = (locals: Item[], incoming: Item[], name: (item: Item) => string) =>
  incoming.map((item): Judged<Item> => {
    const mine = locals.find((other) => other.id === item.id);
    let status: Status = "conflicting";
    if (!mine) status = "added";
    else if (JSON.stringify(mine) === JSON.stringify(item)) status = "same";
    return { id: item.id, name: name(item), status, item };
  });

/**
 * A host as the preview names it: its name and where it points (protocol, host and port), so the
 * person sees which machine comes back. A login or a query in the address is not shown.
 */
export function hostLabel(host: { name: string; url: string }): string {
  try {
    const where = new URL(host.url);
    return `${host.name} (${where.protocol}//${where.host})`;
  } catch {
    return host.name;
  }
}

export const summary = (judged: Array<Judged<unknown>>): KindSummary => {
  const names = (status: Status) =>
    Object.freeze(judged.filter((one) => one.status === status).map((one) => one.name));
  return Object.freeze({
    added: names("added"),
    same: names("same"),
    conflicting: names("conflicting"),
  }) as KindSummary;
};
