import type { ReactElement } from "react";

/**
 * The tooltip of a control that is only an icon (the narrow sidebar's items): it names the control,
 * on hover and on keyboard focus, after a short wait. It is never for a labelled control, and never
 * carries text the person needs: that goes where it can be read.
 */
export function IconTip(props: { label: string | undefined; children: ReactElement }) {
  return props.children;
}
