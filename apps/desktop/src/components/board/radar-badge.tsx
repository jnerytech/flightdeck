import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * The conflict radar's mark on a card (#1405): the words the radar wrote, as a badge with an icon
 * like the other warning badges. In a narrow column the words wrap inside the card instead of being
 * cut at its edge (#1486); the full text stays the badge's name.
 */
export function RadarBadge(props: Readonly<{ text: string }>) {
  return (
    <Badge
      variant="outline"
      className="max-w-full whitespace-normal text-left text-status-needs-you"
    >
      <TriangleAlert aria-hidden="true" />
      {props.text}
    </Badge>
  );
}
