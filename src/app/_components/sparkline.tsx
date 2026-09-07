// A minimal inline sparkline. No chart library — this is one path element,
// and pulling in a dependency for it would cost more than it saves.

export function Sparkline({
  values,
  direction,
}: {
  values: number[];
  direction: "higher_is_better" | "lower_is_better";
}) {
  if (values.length < 2) {
    return <span className="muted">not enough data yet</span>;
  }

  const width = 240;
  const height = 40;
  const pad = 3;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; render it as a centered line.
  const span = max - min || 1;

  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const first = values[0]!;
  const last = values[values.length - 1]!;
  const improved = direction === "higher_is_better" ? last >= first : last <= first;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Trend from ${first} to ${last}`}
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={improved ? "var(--pass)" : "var(--fail)"}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
