export function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? done / total : 0;
  return (
    <div className="relative h-16 w-16 shrink-0" role="img" aria-label={`${done} de ${total} concluídas`}>
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="6"
          className="stroke-zinc-200 dark:stroke-zinc-700"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className="stroke-indigo-600 transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
        {done}/{total}
      </span>
    </div>
  );
}
