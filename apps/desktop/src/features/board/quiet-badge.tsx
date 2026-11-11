import { Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * A card whose session says nothing (#1553, the #1478 spec): the words ("Quiet 23 min") and an
 * hourglass, as a badge like the other warning ones. Not a button. The words are for the eye; a
 * screen reader reads the row's full status line ("Quiet for 23 min · last: Bash") instead.
 */
export function QuietBadge(props: Readonly<{ short: string; full: string }>) {
  return (
    <Badge
      variant="outline"
      className="max-w-full whitespace-normal text-left text-status-needs-you"
    >
      <Hourglass aria-hidden="true" />
      <span aria-hidden="true">{props.short}</span>
      <span className="sr-only">{props.full}</span>
    </Badge>
  );
}
