"use client";

import { useRouter } from "next/navigation";

type MonthOption = {
  value: string;
  label: string;
};

type MonthSelectorProps = {
  selectedMonth: string;
  options: MonthOption[];
  previousMonth: string;
  nextMonth: string;
  basePath?: string;
  extraParams?: Record<string, string | undefined>;
};

export function MonthSelector({
  selectedMonth,
  options,
  previousMonth,
  nextMonth,
  basePath = "/dashboard",
  extraParams,
}: MonthSelectorProps) {
  const router = useRouter();

  const goToMonth = (month: string) => {
    const params = new URLSearchParams();
    params.set("month", month);

    Object.entries(extraParams ?? {}).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    router.push(`${basePath}?${params.toString()}`);
  };

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <button
        type="button"
        onClick={() => goToMonth(previousMonth)}
        aria-label="Mes anterior"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        ‹
      </button>

      <select
        aria-label="Seleccionar mes"
        value={selectedMonth}
        onChange={(event) => goToMonth(event.target.value)}
        className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 sm:w-52"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => goToMonth(nextMonth)}
        aria-label="Mes siguiente"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        ›
      </button>
    </div>
  );
}
