import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";

/** The two dates of a custom range. */
export function RangeInputs(
  props: Readonly<{
    range: { from: string; to: string };
    onRange(range: { from: string; to: string }): void;
  }>,
) {
  const t = useT();
  const { range } = props;
  return (
    <>
      <Input
        type="date"
        aria-label={t("costsUi.from")}
        className="h-8 w-36 text-xs"
        value={range.from}
        onChange={(e) => props.onRange({ ...range, from: e.target.value })}
      />
      <Input
        type="date"
        aria-label={t("costsUi.to")}
        className="h-8 w-36 text-xs"
        value={range.to}
        onChange={(e) => props.onRange({ ...range, to: e.target.value })}
      />
    </>
  );
}
