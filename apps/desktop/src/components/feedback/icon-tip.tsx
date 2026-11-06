import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The tooltip of a control that is only an icon (the narrow sidebar's items): it names the control,
 * on hover and on keyboard focus, after a short wait. It is never for a labelled control, and never
 * carries text the person needs: that goes where it can be read. Never a native `title`, which
 * keyboard users do not get.
 */
export function IconTip(props: { label: string | undefined; children: ReactElement }) {
  if (!props.label) return props.children;
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>{props.children}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {props.label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
