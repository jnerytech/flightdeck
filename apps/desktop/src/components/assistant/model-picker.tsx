import type { ModelOption } from "@flightdeck/protocol";
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
  effort?: { label: string; levels: string[]; value: string; onChange(level: string): void };
}

export function ModelPicker(_props: ModelPickerProps) {
  return <div />;
}
