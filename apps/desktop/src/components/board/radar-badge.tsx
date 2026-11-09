import { Badge } from "@/components/ui/badge";

/** The conflict radar's mark on a card (#1405): the words the radar wrote, as a badge. */
export function RadarBadge(props: Readonly<{ text: string }>) {
  return (
    <Badge variant="outline" className="text-status-needs-you">
      {props.text}
    </Badge>
  );
}
