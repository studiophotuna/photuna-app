// src/components/dashboard/DashboardSkeleton.js
//
// The one loading state between sign-in and a fully loaded dashboard. It has
// the dashboard's own shape (sidebar, header, cards), so the real dashboard
// replaces it in place instead of the screen changing twice.
//
// The operator's sidebar width and theme are not loaded yet, so they come from
// localStorage, which the dashboard keeps up to date.

import React from "react";

export const SIDEBAR_COLLAPSED_KEY = "photuna.sidebarCollapsed";
export const DASHBOARD_THEME_KEY = "photuna.dashboardTheme";

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readSidebarCollapsed() {
  return readStorage(SIDEBAR_COLLAPSED_KEY) === "1";
}

function prefersDark() {
  const theme = readStorage(DASHBOARD_THEME_KEY);
  if (theme === "dark") return true;
  if (theme === "system") {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  }
  return false;
}

export default function DashboardSkeleton() {
  const collapsed = readSidebarCollapsed();
  const dark = prefersDark();
  const block = dark ? "bg-slate-800" : "bg-slate-200/80";
  const card = dark
    ? "bg-slate-900 border border-slate-800"
    : "bg-white border border-slate-200/80";

  const Bar = ({ className = "", style }) => (
    <div className={`animate-pulse rounded-md ${block} ${className}`} style={style} />
  );

  return (
    <div
      className={`flex h-screen w-full overflow-hidden ${dark ? "bg-slate-950" : "bg-[linear-gradient(180deg,_#f8faff_0%,_#f1f5f9_100%)]"}`}
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      {/* Sidebar */}
      <aside
        className={`hidden xl:flex h-screen flex-shrink-0 flex-col border-r ${dark ? "border-slate-800 bg-slate-900/90" : "border-slate-200/80 bg-slate-50/80"} ${collapsed ? "w-[76px]" : "w-[280px]"}`}
      >
        <div className={`flex items-center gap-2.5 pt-5 pb-3 ${collapsed ? "justify-center px-2" : "px-5"}`}>
          <Bar className="h-9 w-9 rounded-xl" />
          {!collapsed && <Bar className="h-6 w-32" />}
        </div>
        <div className={`flex items-center gap-3 border-b py-4 ${dark ? "border-slate-800" : "border-slate-200/80"} ${collapsed ? "justify-center px-2" : "px-6"}`}>
          <Bar className="h-10 w-10 rounded-xl" />
          {!collapsed && (
            <div className="flex-1 space-y-2">
              <Bar className="h-3 w-3/4" />
              <Bar className="h-2.5 w-1/2" />
            </div>
          )}
        </div>
        <div className={`flex-1 space-y-2 py-5 ${collapsed ? "px-3" : "px-5"}`}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className={`flex items-center gap-3 py-2 ${collapsed ? "justify-center" : ""}`}>
              <Bar className="h-4 w-4 rounded" />
              {!collapsed && <Bar className="h-3" style={{ width: `${55 + ((i * 17) % 35)}%` }} />}
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-hidden">
        <div className="mx-auto w-full max-w-[1600px] px-4 pt-14 pb-4 xl:pt-6 xl:px-8 2xl:px-10 space-y-5">
          <div className="space-y-2">
            <Bar className="h-7 w-64" />
            <Bar className="h-3.5 w-96 max-w-full" />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`rounded-2xl p-4 ${card}`}>
                <Bar className="h-3 w-20" />
                <Bar className="mt-3 h-7 w-16" />
                <Bar className="mt-3 h-2.5 w-24" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
            <div className={`rounded-2xl p-5 ${card}`}>
              <Bar className="h-3 w-28" />
              <div className="mt-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Bar key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            </div>
            <div className="space-y-5">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className={`rounded-2xl p-5 ${card}`}>
                  <Bar className="h-3 w-24" />
                  <div className="mt-4 space-y-3">
                    <Bar className="h-3 w-full" />
                    <Bar className="h-3 w-5/6" />
                    <Bar className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
