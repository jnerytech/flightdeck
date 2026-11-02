import type * as React from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A square icon button for a row of actions: the label (from the dictionary) names it for
 * assistive technology and shows as its tooltip, so the row stays short and aligned.
 */
export function IconActionButton(
  props: Omit<React.ComponentProps<typeof ActionButton>, "aria-label" | "size"> & {
    label: string;
  },
) {
  const { label, children, ...rest } = props;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <ActionButton variant="outline" size="icon-sm" aria-label={label} {...rest}>
            {children}
          </ActionButton>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
