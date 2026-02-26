"use client";
import {
  AlertTriangle,
  Building2,
  Flag,
  Trash2,
  Upload
} from 'lucide-react';
import React, { useRef, useState } from 'react';

// --- TYPES ---
interface Party {
  id: number;
  name: string;
  abbreviation: string;
  color: string;
  logo?: string; // Optional logo field
}

export default function PartyManager() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Initial list with placeholder style logos
  const [parties, setParties] = useState<Party[]>([
    { id: 1, name: 'Bharatiya Janata Party', abbreviation: 'BJP', color: 'bg-orange-500' },
    { id: 2, name: 'Indian National Congress', abbreviation: 'INC', color: 'bg-blue-500' },
    { id: 3, name: 'Samajwadi Party', abbreviation: 'SP', color: 'bg-red-600' },
    { id: 4, name: 'Aam Aadmi Party', abbreviation: 'AAP', color: 'bg-sky-600' },
    { id: 5, name: 'Bahujan Samaj Party', abbreviation: 'BSP', color: 'bg-blue-800' },
    { id: 6, name: 'Rashtriya Janata Dal', abbreviation: 'RJD', color: 'bg-green-600' },
    { id: 7, name: 'Trinamool Congress', abbreviation: 'TMC', color: 'bg-emerald-500' },
    { id: 8, name: 'Shiv Sena', abbreviation: 'SHS', color: 'bg-orange-600' },
  ]);

  const [newName, setNewName] = useState('');
  const [newAbbr, setNewAbbr] = useState('');
  const [selectedLogo, setSelectedLogo] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<Party | null>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setSelectedLogo(url);
    }
  };

  const addParty = () => {
    if (newName.trim() && newAbbr.trim()) {
      const newParty: Party = {
        id: Date.now(),
        name: newName.trim(),
        abbreviation: newAbbr.trim().toUpperCase(),
        color: 'bg-slate-500',
        logo: selectedLogo || undefined
      };
      setParties([newParty, ...parties]);
      setNewName('');
      setNewAbbr('');
      setSelectedLogo(null);
    }
  };

  const confirmDelete = () => {
    if (isDeleting) {
      setParties(parties.filter(p => p.id !== isDeleting.id));
      setIsDeleting(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 text-slate-700 pb-20">
      
      {/* DELETE CONFIRMATION MODAL */}
      {isDeleting && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <AlertTriangle size={40} />
            </div>
            <p className="font-black text-xl text-slate-900 leading-tight">Delete Party?</p>
            <div className="flex gap-4">
              <button onClick={() => setIsDeleting(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold text-slate-600">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-lg shadow-red-200">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER CARD */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-100">
            <Flag size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Parties</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">Manage political parties</p>
          </div>
        </div>
      </div>

      {/* ADD PARTY STRIP */}
      <div className="bg-white p-3 rounded-[35px] border border-slate-200 shadow-lg flex flex-col lg:flex-row items-stretch gap-4">
        
        {/* LOGO UPLOAD BOX */}
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="w-full lg:w-24 h-24 lg:h-auto min-h-[80px] bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all group overflow-hidden relative"
        >
          {selectedLogo ? (
            <img src={selectedLogo} className="w-full h-full object-cover" alt="Logo preview" />
          ) : (
            <>
              <Upload size={20} className="text-slate-400 group-hover:text-blue-500 mb-1" />
              <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Logo</span>
            </>
          )}
          <input type="file" ref={fileInputRef} onChange={handleLogoChange} className="hidden" accept="image/*" />
        </div>

        <div className="flex items-center gap-4 flex-[2] bg-slate-50 p-3 rounded-2xl border border-slate-100 transition-all focus-within:border-blue-300">
          <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shrink-0 shadow-md">
            <Building2 size={20} />
          </div>
          <div className="flex-1">
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Party Name</span>
             <input 
               type="text" 
               value={newName} 
               onChange={e => setNewName(e.target.value)} 
               placeholder="e.g. Bharatiya Janata Party" 
               className="w-full bg-transparent outline-none font-bold text-slate-800 placeholder:text-slate-300" 
             />
          </div>
        </div>

        <div className="flex items-center gap-4 flex-1 bg-slate-50 p-3 rounded-2xl border border-slate-100 transition-all focus-within:border-blue-300">
          <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0 font-black text-[10px] uppercase">
            Abbr
          </div>
          <div className="flex-1">
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Short Name</span>
             <input 
               type="text" 
               value={newAbbr} 
               onChange={e => setNewAbbr(e.target.value)} 
               placeholder="e.g. BJP" 
               className="w-full bg-transparent outline-none font-bold text-slate-800 uppercase placeholder:text-slate-300" 
             />
          </div>
        </div>

        <button 
          onClick={addParty} 
          disabled={!newName || !newAbbr} 
          className="bg-blue-600 text-white px-12 rounded-2xl font-black text-xs hover:bg-slate-900 disabled:opacity-30 transition-all uppercase tracking-widest shadow-xl shadow-blue-100 min-h-[56px] lg:min-h-0 active:scale-95"
        >
          Add
        </button>
      </div>

      {/* PARTY LIST GRID */}
      <div className="space-y-6">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 px-2">
            <Flag size={14} className="text-blue-500" /> Parties ({parties.length})
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {parties.map((party) => (
            <div key={party.id} className="bg-white p-7 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col">
              <div className="flex justify-between items-start mb-6">
                
                {/* LOGO DISPLAY */}
                <div className={`w-16 h-16 rounded-2xl ${party.color} flex items-center justify-center text-white font-black text-sm shadow-lg ring-4 ring-white overflow-hidden`}>
                  {party.logo ? (
                    <img src={party.logo} className="w-full h-full object-cover" alt={party.abbreviation} />
                  ) : (
                    party.abbreviation
                  )}
                </div>

                <button 
                  onClick={() => setIsDeleting(party)} 
                  className="p-2 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              
              <h4 className="font-black text-slate-900 text-lg leading-tight tracking-tight mb-4">{party.name}</h4>
              
              <button className="mt-auto w-full py-3.5 bg-slate-50 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-all flex items-center justify-center gap-2">
                Edit Details
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}