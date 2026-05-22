'use client';

import React from 'react';
import { ChevronDown, X } from 'lucide-react';

/** Multi-select dropdown with checkboxes, ALL option, search, and tag display. */
export function MultiSelectDropdown<T extends { id: string | number }>({
  label,
  options,
  selected,
  onSelect,
  getValue,
  getLabel,
  allLabel = 'ALL',
  loading = false,
  optionLeading,
  showAllOption = true,
  searchable = false,
  searchPlaceholder = 'Search…',
}: {
  label: string;
  options: T[];
  selected: string[];
  onSelect: (vals: string[]) => void;
  getValue: (o: T) => string;
  getLabel: (o: T) => string;
  allLabel?: string;
  loading?: boolean;
  optionLeading?: (o: T) => React.ReactNode;
  showAllOption?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);
  const isAll = selected.includes('ALL');
  const displayItems = isAll
    ? [{ val: 'ALL', lbl: allLabel }]
    : selected.map((v) => {
        const vStr = String(v);
        const opt = options.find((o) => String(getValue(o)) === vStr);
        return { val: vStr, lbl: opt ? getLabel(opt) : vStr };
      });

  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filteredOptions =
    !searchable || !query.trim()
      ? options
      : options.filter((o) => getLabel(o).toLowerCase().includes(query.trim().toLowerCase()));

  const toggle = (val: string) => {
    if (val === 'ALL') {
      onSelect(isAll ? [] : ['ALL']);
      return;
    }
    const valStr = String(val);
    const next = selected.some((x) => String(x) === valStr)
      ? selected.filter((x) => String(x) !== valStr)
      : [...selected, valStr];
    onSelect(next.length ? next : []);
  };

  const removeTag = (val: string) => {
    if (val === 'ALL') onSelect([]);
    else onSelect(selected.filter((x) => String(x) !== val));
  };

  return (
    <div className="flex flex-col w-full" ref={ref}>
      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</span>
      <div className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={() => !loading && setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (!loading && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              setOpen((o) => !o);
            }
          }}
          className={`w-full bg-slate-50 p-2.5 rounded-xl border border-slate-100 outline-none font-bold text-slate-800 text-sm text-left flex items-center justify-between min-h-[40px] ${loading ? 'cursor-wait opacity-70' : 'cursor-pointer'}`}
        >
          <div className="flex flex-wrap gap-1 flex-1">
            {loading ? (
              <span className="text-slate-400">Loading…</span>
            ) : displayItems.length === 0 ? (
              <span className="text-slate-400">Select…</span>
            ) : (
              displayItems.map(({ val, lbl }) => (
                <span
                  key={val}
                  className="inline-flex items-center gap-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-md"
                >
                  {lbl}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      removeTag(val);
                    }}
                    className="hover:bg-blue-200 rounded p-0.5"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))
            )}
          </div>
          <ChevronDown size={14} className="text-slate-400 shrink-0 ml-1" />
        </div>
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto py-2">
            {searchable && (
              <div className="px-3 pb-2 sticky top-0 bg-white z-10">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            )}
            {showAllOption && (
              <label className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={isAll} onChange={() => toggle('ALL')} className="rounded" />
                <span className="text-sm font-bold">{allLabel}</span>
              </label>
            )}
            {filteredOptions.map((o) => {
              const v = String(getValue(o));
              const checked = isAll || selected.some((s) => String(s) === v);
              const disabled = isAll && showAllOption;
              return (
                <label
                  key={String(o.id)}
                  className={`flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => !disabled && toggle(v)}
                    className="rounded"
                  />
                  {optionLeading?.(o)}
                  <span className="text-sm font-bold">{getLabel(o)}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
