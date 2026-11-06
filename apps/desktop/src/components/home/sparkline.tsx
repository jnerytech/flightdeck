/**
 * Seven days as one line over a faint area, no axes: the number above it says what it is. One
 * accent; the area is the same color at a low opacity. The label gives the values to a screen
 * reader, which cannot read the shape.
 */
export function Sparkline(props: { values: number[]; label: string }) {
  const width = 100;
  const height = 32;
  const pad = 3;
  const top = Math.max(...props.values, 0);
  const step = props.values.length > 1 ? width / (props.values.length - 1) : 0;
  const points = props.values.map((v, i) => [
    i * step,
    top === 0 ? height - pad : height - pad - (v / top) * (height - 2 * pad),
  ]);
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x?.toFixed(2)},${y?.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="spark"
    >
      <path d={area} className="spark-area" />
      <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
