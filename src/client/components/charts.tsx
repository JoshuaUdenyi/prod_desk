/**
 * Two small hand-rolled charts.
 *
 * PRD §8 says to avoid complex charting in the first release, so these are plain
 * SVG — no charting dependency, no canvas, and they inherit the design tokens.
 */

import { useMemo, useState } from 'react';
import { cn } from '../lib/cn';

const W = 600;
const H = 190;
const PAD_Y = 16;

export interface TrendPoint {
  label: string;
  value: number;
}

/** Smooth path through the points using quadratic midpoints. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (!points.length) return '';

  const first = points[0];
  if (!first) return '';
  if (points.length === 1) return `M ${first.x} ${first.y}`;

  let d = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    const midX = (previous.x + current.x) / 2;
    const midY = (previous.y + current.y) / 2;
    d += ` Q ${previous.x} ${previous.y} ${midX} ${midY}`;
    if (index === points.length - 1) d += ` L ${current.x} ${current.y}`;
  }
  return d;
}

export function TrendChart({
  data,
  formatValue,
  className,
  accent = 'var(--color-accent)',
}: {
  data: TrendPoint[];
  formatValue: (value: number) => string;
  className?: string;
  accent?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (!data.length) return null;

    const values = data.map((point) => point.value);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;

    const points = data.map((point, index) => ({
      x: data.length === 1 ? W / 2 : (index / (data.length - 1)) * W,
      y: H - PAD_Y - ((point.value - min) / span) * (H - PAD_Y * 2),
    }));

    return { points, path: smoothPath(points), areaPath: `${smoothPath(points)} L ${W} ${H} L 0 ${H} Z` };
  }, [data]);

  if (!geometry) {
    return (
      <div className={cn('grid h-[190px] place-items-center text-xs text-faint', className)}>
        Nothing to chart yet
      </div>
    );
  }

  const active = hovered !== null ? data[hovered] : null;
  const activePoint = hovered !== null ? geometry.points[hovered] : null;
  const gradientId = `trend-${accent.replace(/[^a-z]/gi, '')}`;

  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[190px] w-full"
        role="img"
        aria-label="Trend over the selected period"
        onMouseLeave={() => setHovered(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          const index = Math.round(ratio * (data.length - 1));
          setHovered(Math.max(0, Math.min(data.length - 1, index)));
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={0}
            x2={W}
            y1={H * fraction}
            y2={H * fraction}
            stroke="var(--color-line)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
        <path
          d={geometry.path}
          fill="none"
          stroke={accent}
          strokeWidth={2}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {activePoint ? (
          <>
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={0}
              y2={H}
              stroke="var(--color-line-strong)"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={activePoint.x} cy={activePoint.y} r={5} fill={accent} stroke="var(--color-canvas)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
      </svg>

      {active && activePoint ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[11px] whitespace-nowrap text-ink shadow-xl"
          style={{ left: `${(activePoint.x / W) * 100}%`, top: `${(activePoint.y / H) * 100}%` }}
        >
          <span className="tabular font-semibold">{formatValue(active.value)}</span>
          <span className="ml-1.5 text-faint">{active.label}</span>
        </div>
      ) : null}

      <div className="mt-2 flex justify-between text-[10px] text-faint">
        {data.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Ring gauge: how much of `total` the `value` covers. */
export function Donut({
  value,
  total,
  label,
  size = 84,
  tone = 'var(--color-accent)',
}: {
  value: number;
  total: number;
  label: string;
  size?: number;
  tone?: string;
}) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="-rotate-90" width={size} height={size} aria-hidden>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-line)" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
        />
      </svg>
      <span className="absolute text-[11px] font-semibold text-ink">{Math.round(ratio * 100)}%</span>
      <span className="sr-only">{label}</span>
    </div>
  );
}
