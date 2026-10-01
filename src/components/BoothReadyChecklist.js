import React from 'react';

// "Get booth-ready": the onboarding checklist a new operator lands on after
// signing up, on the website or in the app.
//
// It leans on the endowed-progress effect: the first steps (installing the app,
// creating the account) are already behind them by the time they see it, so the
// bar starts part-way along and only a few concrete steps remain. Every step is
// detected from real state, never ticked by hand, so the head start is honest.
//
// The steps and their order live in BOOTH_READY_STEPS so the sign-up screen
// (AuthGate) can show the same scale and the bar never appears to go backwards.

export const BOOTH_READY_STEPS = [
  { id: 'installed', label: 'App installed' },
  { id: 'account',   label: 'Account created' },
  { id: 'event',     label: 'Create your first event' },
  { id: 'camera',    label: 'Camera ready' },
  { id: 'photo',     label: 'Take your first photo' },
];

export function boothReadyPercent(doneCount) {
  return Math.round((doneCount / BOOTH_READY_STEPS.length) * 100);
}

const Check = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

/**
 * @param {{
 *   status: Record<string, boolean>,
 *   actions: Record<string, { label: string, hint: string, onClick: () => void }>,
 *   onDismiss: () => void,
 * }} props
 */
export default function BoothReadyChecklist({ status, actions, onDismiss }) {
  const steps = BOOTH_READY_STEPS.map((s) => ({ ...s, done: Boolean(status[s.id]) }));
  const doneCount = steps.filter((s) => s.done).length;
  const pct = boothReadyPercent(doneCount);
  const complete = doneCount === steps.length;
  const next = steps.find((s) => !s.done);

  return (
    <section
      aria-label="Get booth-ready"
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-[0_6px_20px_rgba(15,23,42,0.06)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">Get booth-ready</p>
          <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100" style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}>
            {complete
              ? 'Your booth is ready for guests'
              : `${doneCount} of ${steps.length} done — ${next.label.toLowerCase()} next`}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black text-blue-600 dark:text-blue-400">{pct}%</span>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-2 py-1 text-xs font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            {complete ? 'Done' : 'Hide'}
          </button>
        </div>
      </div>

      <div
        className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-blue-600 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((step) => {
          const action = actions[step.id];
          const isNext = next?.id === step.id;
          return (
            <li
              key={step.id}
              className={[
                'flex flex-col gap-2 rounded-lg border px-3 py-3 transition',
                step.done
                  ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                  : isNext
                    ? 'border-blue-300 bg-blue-50/60 dark:border-blue-500/40 dark:bg-blue-500/10'
                    : 'border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/50',
              ].join(' ')}
            >
              <div className="flex items-center gap-2">
                <span
                  className={[
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                    step.done ? 'bg-emerald-500 text-white' : 'border-2 border-slate-300 dark:border-slate-600',
                  ].join(' ')}
                >
                  {step.done ? <Check /> : null}
                </span>
                <span className={`text-sm font-semibold ${step.done ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100'}`}>
                  {step.label}
                </span>
              </div>
              {!step.done && action ? (
                <>
                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{action.hint}</p>
                  <button
                    type="button"
                    onClick={action.onClick}
                    className={[
                      'mt-auto inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition active:scale-[0.98]',
                      isNext
                        ? 'bg-blue-600 text-white shadow-sm shadow-blue-200 hover:bg-blue-700 dark:shadow-none'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200',
                    ].join(' ')}
                  >
                    {action.label}
                  </button>
                </>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
