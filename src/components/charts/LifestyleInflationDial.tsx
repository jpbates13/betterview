import { useEffect, useMemo, useState } from 'react';

type LifestyleInflationDialProps = {
  score: number | null;
  deltaPercent: number | null;
  deltaAmount: number | null;
  incomeDeltaPercent: number | null;
  incomeDeltaAmount: number | null;
  comparisonLabel?: string;
  isLoading?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const polarToCartesian = (cx: number, cy: number, radius: number, angleDeg: number) => {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
};

const describeArc = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
};

export default function LifestyleInflationDial({
  score,
  deltaPercent,
  deltaAmount,
  incomeDeltaPercent,
  incomeDeltaAmount,
  comparisonLabel,
  isLoading = false,
}: LifestyleInflationDialProps) {
  const hasData = score !== null && Number.isFinite(score);
  const safeScore = hasData ? clamp(score, -100, 100) : 0;

  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    const target = hasData ? safeScore : 0;
    let rafId = 0;
    const durationMs = 700;
    const start = performance.now();
    const initial = animatedScore;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = initial + (target - initial) * eased;
      setAnimatedScore(next);

      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [safeScore, hasData]);

  const displayScore = hasData ? animatedScore : 0;
  const animatedNeedleAngle = ((clamp(displayScore, -100, 100) + 100) / 200) * 180 - 90;
  const scoreText = useMemo(
    () => (hasData ? animatedScore.toFixed(1) : '—'),
    [hasData, animatedScore]
  );

  const needleEnd = polarToCartesian(110, 110, 62, animatedNeedleAngle);

  const trendLabel = !hasData
    ? 'Not enough data yet'
    : safeScore >= 8
      ? 'Lifestyle Inflating'
      : safeScore <= -8
        ? 'Lifestyle Deflating'
        : 'Lifestyle Steady';

  const trendPillClasses = !hasData
    ? 'bg-gray-100 text-gray-600 border-gray-200'
    : safeScore >= 8
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : safeScore <= -8
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-amber-50 text-amber-700 border-amber-200';

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Lifestyle Inflation Index</h2>
          <p className="text-sm text-gray-500 mt-1">
            A quick read on whether your net spend is drifting up or down.
          </p>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold ${trendPillClasses}`}>
          {trendLabel}
        </span>
      </div>

      {isLoading ? (
        <div className="h-[180px] flex items-center justify-center">
          <div className="h-8 w-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5 items-center">
          <div className="mx-auto w-full max-w-[220px]">
            <svg viewBox="0 0 220 140" className="w-full h-auto">
              <path d={describeArc(110, 110, 72, -90, -30)} stroke="#22C55E" strokeWidth="13" fill="none" strokeLinecap="round" />
              <path d={describeArc(110, 110, 72, -30, 30)} stroke="#F59E0B" strokeWidth="13" fill="none" strokeLinecap="round" />
              <path d={describeArc(110, 110, 72, 30, 90)} stroke="#EF4444" strokeWidth="13" fill="none" strokeLinecap="round" />

              <line
                x1="110"
                y1="110"
                x2={needleEnd.x}
                y2={needleEnd.y}
                stroke="#0F172A"
                strokeWidth="3.5"
                strokeLinecap="round"
                className="transition-all duration-500"
              />
              <circle cx="110" cy="110" r="6" fill="#0F172A" />
            </svg>

            <div className="mt-2 px-1 flex items-center justify-between text-[11px] font-medium text-gray-500 uppercase tracking-wide">
              <span>Deflating</span>
              <span>Steady</span>
              <span>Inflating</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Index Score</p>
              <p className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">{scoreText}</p>
              <p className="text-sm text-gray-500 mt-1">Range: -100 (deflating) to +100 (inflating)</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Spend Delta</p>
                <p className="text-xl font-semibold text-gray-900 mt-1">
                  {deltaAmount !== null ? `${deltaAmount > 0 ? '+' : ''}$${Math.abs(deltaAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Spend Relative Change</p>
                <p className="text-xl font-semibold text-gray-900 mt-1">
                  {deltaPercent !== null ? `${deltaPercent > 0 ? '+' : ''}${deltaPercent.toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Income Delta</p>
                <p className="text-xl font-semibold text-gray-900 mt-1">
                  {incomeDeltaAmount !== null ? `${incomeDeltaAmount > 0 ? '+' : ''}$${Math.abs(incomeDeltaAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Income Relative Change</p>
                <p className="text-xl font-semibold text-gray-900 mt-1">
                  {incomeDeltaPercent !== null ? `${incomeDeltaPercent > 0 ? '+' : ''}${incomeDeltaPercent.toFixed(1)}%` : '—'}
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-500">{comparisonLabel || 'Compared with the prior period.'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
