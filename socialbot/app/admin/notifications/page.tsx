"use client";

import React from "react";

export default function AdminNotificationsPage() {
  // Intentionally minimal: no dummy stats, no placeholder charts.
  return (
    <div className="max-w-7xl mx-auto pb-20 text-slate-700">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Notifications</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-3 leading-none">
            Broadcast Center
          </p>
        </div>
      </div>
      <div className="bg-white rounded-[35px] border border-slate-100 shadow-sm p-8" />
    </div>
  );
}

