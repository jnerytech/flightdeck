import type * as React from "react";
import { ActionButton } from "@/components/feedback/action-button";

export function IconActionButton(
  props: Omit<React.ComponentProps<typeof ActionButton>, "aria-label"> & { label: string },
) {
  const { label, ...rest } = props;
  return <ActionButton {...rest}>{label}</ActionButton>;
}
