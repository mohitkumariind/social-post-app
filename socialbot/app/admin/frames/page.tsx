"use client";
import {
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Layers,
  Plus,
  Search,
  Trash2,
  Upload
} from 'lucide-react';
import React, { useRef, useState } from 'react';

// --- TYPES ---
interface FrameAsset {
  id: number;
  name: string;
  url: string;
  partyName: string;
  stateName: string;
}

export default function FrameManager() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'list' | 'add'>('list');

  // --- MOCK DATA ---
  const [frames, setFrames] = useState<FrameAsset[]>([
    { id: 1, name: 'BJP Holi 2026', url: 'https://placehold.co/400x600/png?text=Frame+1', partyName: 'BJP', stateName: 'Uttar Pradesh' },
    { id: 2, name: 'INC Daily Greeting', url: 'https://placehold.co/400x600/png?text=Frame+2', partyName: 'INC', stateName: 'Maharashtra' },
  ]);

  // --- FORM STATES ---
  const [newName, setNewName] = useState('');
  const [selectedParty, setSelectedParty] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<FrameAsset | null>(null);

  // --- HANDLERS ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleAdd = () => {
    if (!newName || !previewUrl) return;
    const newFrame: FrameAsset = {
      id: Date.now(),
      name: newName,
      url: previewUrl,
      partyName: selectedParty || 'General',
      stateName: selectedState || 'All India'
    };
    setFrames([newFrame, ...frames]);
    setNewName(''); setPreviewUrl(null); setSelectedParty(''); setSelectedState('');
    setView('list');
  };

  const confirmDelete = () => {
    if (isDeleting) {
      setFrames(frames.filter(f => f.id !== isDeleting.id));
      setIsDeleting(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 text-slate-700 pb-20">
      
      {/* DELETE MODAL */}
      {isDeleting && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><AlertTriangle size={40} /></div>
            <p className="font-black text-xl text-slate-900 leading-tight">Delete Frame?</p>
            <div className="flex gap-4">
              <button onClick={() => setIsDeleting(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-lg shadow-red-200">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
            <Layers size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Frames</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">Manage political overlays</p>
          </div>
        </div>
        <button 
          onClick={() => setView(view === 'list' ? 'add' : 'list')}
          className="bg-slate-900 text-white px-8 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 transition-all shadow-xl shadow-slate-100 flex items-center gap-2"
        >
          {view === 'list' ? <Plus size={18} /> : <ArrowLeft size={18} />}
          {view === 'list' ? 'Add Frame' : 'Back'}
        </button>
      </div>

      {/* VIEW: ADD FRAME FORM */}
      {view === 'add' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-4">
          {/* Form Side */}
          <div className="bg-white p-10 rounded-[40px] border border-slate-100 shadow-sm space-y-8">
            <h3 className="text-lg font-black text-slate-900">Frame Details</h3>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Frame Name</label>
                <input 
                  type="text" 
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. BJP Meerut Rally" 
                  className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-blue-500 font-bold transition-all" 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Party Link</label>
                  <select 
                    value={selectedParty}
                    onChange={e => setSelectedParty(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none font-bold text-sm"
                  >
                    <option value="">General</option>
                    <option>BJP</option>
                    <option>INC</option>
                    <option>SP</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Geography Link</label>
                  <select 
                    value={selectedState}
                    onChange={e => setSelectedState(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none font-bold text-sm"
                  >
                    <option value="">All India</option>
                    <option>Uttar Pradesh</option>
                    <option>Maharashtra</option>
                  </select>
                </div>
              </div>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-4 border-dashed border-slate-100 rounded-[35px] p-10 text-center hover:border-blue-500 hover:bg-blue-50/30 transition-all group cursor-pointer"
              >
                <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner">
                  <Upload size={28} />
                </div>
                <p className="font-black text-xs uppercase tracking-widest text-slate-400 group-hover:text-blue-600">Select Transparent PNG</p>
                <p className="text-[10px] text-slate-300 font-bold mt-1 uppercase">1080x1350 (4:5) recommended</p>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/png" />
              </div>

              <button 
                onClick={handleAdd}
                disabled={!newName || !previewUrl}
                className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-blue-100 disabled:opacity-30 hover:bg-slate-900 transition-all"
              >
                Create Frame
              </button>
            </div>
          </div>

          {/* Preview Side */}
          <div className="flex flex-col gap-6">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] px-2 flex items-center gap-2">
              <ImageIcon size={14} className="text-blue-500" /> Preview
            </h3>
            <div className="aspect-[4/5] bg-slate-900 rounded-[45px] overflow-hidden relative shadow-2xl border-8 border-white">
                {/* Background Sample */}
                <img src="https://images.unsplash.com/photo-1540910419892-4a36d2c3265c?q=80&w=2070&auto=format&fit=crop" className="w-full h-full object-cover opacity-40 blur-[2px]" alt="preview bg" />
                
                {/* The Uploaded Frame Overlaid */}
                {previewUrl && (
                  <img src={previewUrl} className="absolute inset-0 w-full h-full object-contain z-10" alt="frame layer" />
                )}

                <div className="absolute inset-0 flex items-center justify-center">
                  {!previewUrl && <p className="text-white/20 font-black uppercase tracking-widest text-xs">Upload PNG to preview</p>}
                </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: LIST (GRID) */}
      {view === 'list' && (
        <div className="space-y-8 animate-in fade-in">
          <div className="flex flex-wrap gap-4 items-center justify-between px-2">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-500" /> Live Frames ({frames.length})
            </h3>
            <div className="relative group">
              <Search className="absolute left-3 top-2 text-slate-300 group-focus-within:text-blue-500 transition-colors" size={14} />
              <input type="text" placeholder="Filter frames..." className="bg-white border border-slate-100 rounded-xl pl-9 pr-4 py-2 text-[10px] font-bold outline-none shadow-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
            {frames.map((frame) => (
              <div key={frame.id} className="flex flex-col gap-4 group">
                <div className="aspect-[4/5] bg-slate-100 rounded-[40px] overflow-hidden relative shadow-md hover:shadow-2xl hover:-translate-y-1 transition-all duration-500 cursor-pointer">
                  <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10" />
                  <img src={frame.url} className="w-full h-full object-contain relative z-10 p-4" alt={frame.name} />
                  
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-all z-20">
                    <button 
                      onClick={() => setIsDeleting(frame)}
                      className="w-10 h-10 bg-rose-500 text-white rounded-xl flex items-center justify-center shadow-lg hover:bg-rose-600 transition-all active:scale-90"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                  <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-1">
                    <span className="bg-blue-600 text-white text-[8px] font-black uppercase px-2 py-0.5 rounded-md w-fit shadow-lg">{frame.partyName}</span>
                    <span className="bg-white/80 backdrop-blur-md text-slate-900 text-[8px] font-black uppercase px-2 py-0.5 rounded-md w-fit">{frame.stateName}</span>
                  </div>
                </div>
                <div className="px-2">
                  <h4 className="font-black text-slate-900 text-xs leading-tight">{frame.name}</h4>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Ready to Merge</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// Simple internal helper component
const ArrowLeft = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
);