/** A small ring filled by `done` of `total`: the share of the setup checklist that is done. */
export function ProgressRing(props: { done: number; total: number; className?: string }) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const share = props.total === 0 ? 0 : Math.min(1, props.done / props.total);
  return (
    <svg
      data-slot="setup-ring"
      data-done={props.done}
      data-total={props.total}
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={props.className ?? "size-4 shrink-0 -rotate-90"}
    >
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${share * circumference} ${circumference}`}
      />
    </svg>
  );
}
