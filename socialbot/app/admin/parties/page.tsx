"use client";
import { Flag, Info, Users } from 'lucide-react';
import React, { useMemo } from 'react';
import { isPartyOtherId, PARTIES_DATA } from '@/lib/constants';

/** Accent tiles for party cards (cycles); "Other" uses neutral icon tile instead */
const CARD_ACCENT_CLASSES = [
  'bg-orange-500',
  'bg-blue-500',
  'bg-red-600',
  'bg-sky-600',
  'bg-blue-800',
  'bg-green-600',
  'bg-emerald-500',
  'bg-violet-600',
  'bg-rose-600',
  'bg-amber-600',
] as const;

export default function PartyManager() {
  const rows = useMemo(
    () =>
      PARTIES_DATA.map((p, i) => ({
        ...p,
        accentClass: CARD_ACCENT_CLASSES[i % CARD_ACCENT_CLASSES.length],
      })),
    []
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 text-slate-700 pb-20">
      {/* HEADER CARD */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-100">
            <Flag size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Parties</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">
              Same list as the mobile app ({PARTIES_DATA.length} parties)
            </p>
          </div>
        </div>
      </div>

      {/* SYNC NOTICE */}
      <div className="bg-slate-50 border border-slate-200 rounded-[28px] p-6 flex gap-4 items-start">
        <div className="w-11 h-11 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-blue-600 shrink-0 shadow-sm">
          <Info size={22} />
        </div>
        <div>
          <p className="font-black text-slate-900 text-sm uppercase tracking-widest mb-1">Source of truth</p>
          <p className="text-sm font-medium text-slate-600 leading-relaxed">
            This page is a read-only reference. The live party list is defined in{' '}
            <code className="text-xs font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">socialbot/lib/constants.ts</code>{' '}
            and must stay in sync with the mobile app&apos;s{' '}
            <code className="text-xs font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">constants/Parties.ts</code>.
            To add or rename a party, update <code className="text-xs font-mono">PARTIES_DATA</code> in both places.
          </p>
        </div>
      </div>

      {/* PARTY GRID — mirrors mobile PARTIES_DATA */}
      <div className="space-y-6">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 px-2">
          <Flag size={14} className="text-blue-500" /> Registered parties ({rows.length})
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {rows.map((party) => (
            <div
              key={party.id}
              className="bg-white p-7 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col"
            >
              <div className="flex justify-between items-start mb-6">
                {isPartyOtherId(party.id) ? (
                  <div
                    className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-600 shadow-inner ring-4 ring-white"
                    title="Other"
                  >
                    <Users size={28} strokeWidth={2} aria-hidden />
                  </div>
                ) : (
                  <div
                    className={`w-16 h-16 rounded-2xl ${party.accentClass} flex items-center justify-center text-white font-black text-xs shadow-lg ring-4 ring-white text-center leading-tight px-1`}
                  >
                    {party.shortName}
                  </div>
                )}
              </div>

              <h4 className="font-black text-slate-900 text-lg leading-tight tracking-tight mb-1">{party.fullName}</h4>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{party.shortName}</p>
              <p className="mt-auto text-[9px] font-mono text-slate-300 truncate" title={party.id}>
                id: {party.id}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
