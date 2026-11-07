import { cn } from "@/lib/utils";
import { hostColorIndex, hostColorVar } from "../../lib/host-color.ts";

/** A host's color as a dot, never the only sign of the host: its name always stands next to it. */
export function HostDot(props: Readonly<{ hostId: string; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      data-host-dot={hostColorIndex(props.hostId)}
      style={{ backgroundColor: hostColorVar(props.hostId) }}
      className={cn("inline-block size-2 shrink-0 rounded-full", props.className)}
    />
  );
}
