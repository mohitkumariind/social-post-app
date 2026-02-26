"use client";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Globe,
  Map,
  MapPin,
  Search,
  Trash2
} from 'lucide-react';
import { useState } from 'react';

// --- TYPES ---
interface State { id: number; name: string; }
interface District { id: number; name: string; stateId: number; stateName: string; }
interface Constituency { id: number; name: string; districtId: number; districtName: string; }

type GeoTab = 'States' | 'Districts' | 'Constituencies';

// --- CONSTANTS ---
const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", 
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", 
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", 
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", 
  "Uttarakhand", "West Bengal", "Delhi"
];

// Sample Dictionary for Dropdowns (In real app, fetch this from Supabase)
const SAMPLE_ASSEMBLY_DATA: Record<string, string[]> = {
  "Meerut": ["Meerut Cantt", "Meerut South", "Meerut City", "Sardhana", "Hastinapur", "Kithore", "Siwalkhas"],
  "Mumbai City": ["Colaba", "Byculla", "Malabar Hill", "Mumbadevi", "Worli", "Sion Koliwada"],
  "Lucknow": ["Lucknow East", "Lucknow West", "Lucknow North", "Lucknow Central", "Sarojini Nagar"]
};

export default function GeographyManager() {
  const [activeTab, setActiveTab] = useState<GeoTab>('States');
  
  // State Data
  const [states, setStates] = useState<State[]>([
    { id: 1, name: 'Uttar Pradesh' },
    { id: 2, name: 'Maharashtra' }
  ]);

  const [districts, setDistricts] = useState<District[]>([
    { id: 101, name: 'Meerut', stateId: 1, stateName: 'Uttar Pradesh' },
    { id: 102, name: 'Mumbai City', stateId: 2, stateName: 'Maharashtra' }
  ]);

  const [constituencies, setConstituencies] = useState<Constituency[]>([
    { id: 201, name: 'Meerut Cantt', districtId: 101, districtName: 'Meerut' }
  ]);

  // Form States
  const [newName, setNewName] = useState('');
  const [selectedStateId, setSelectedStateId] = useState<number>(0);
  const [selectedDistrictId, setSelectedDistrictId] = useState<number>(0);
  const [isDeleting, setIsDeleting] = useState<{type: GeoTab, item: any} | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Dropdown options based on selected district
  const selectedDistrictName = districts.find(d => d.id === selectedDistrictId)?.name || "";
  const assemblyOptions = SAMPLE_ASSEMBLY_DATA[selectedDistrictName] || [];

  const handleAdd = () => {
    if (!newName.trim()) return;

    if (activeTab === 'States') {
      if(states.find(s => s.name.toLowerCase() === newName.toLowerCase())) return;
      setStates([{ id: Date.now(), name: newName.trim() }, ...states]);
    } else if (activeTab === 'Districts' && selectedStateId) {
      const state = states.find(s => s.id === selectedStateId);
      if(districts.find(d => d.name.toLowerCase() === newName.toLowerCase() && d.stateId === selectedStateId)) return;
      setDistricts([{ id: Date.now(), name: newName.trim(), stateId: selectedStateId, stateName: state?.name || '' }, ...districts]);
    } else if (activeTab === 'Constituencies' && selectedDistrictId) {
      const district = districts.find(d => d.id === selectedDistrictId);
      if(constituencies.find(c => c.name.toLowerCase() === newName.toLowerCase() && c.districtId === selectedDistrictId)) return;
      setConstituencies([{ id: Date.now(), name: newName.trim(), districtId: selectedDistrictId, districtName: district?.name || '' }, ...constituencies]);
    }
    setNewName('');
  };

  const confirmDelete = () => {
    if (!isDeleting) return;
    const { type, item } = isDeleting;
    if (type === 'States') setStates(states.filter(s => s.id !== item.id));
    if (type === 'Districts') setDistricts(districts.filter(d => d.id !== item.id));
    if (type === 'Constituencies') setConstituencies(constituencies.filter(c => c.id !== item.id));
    setIsDeleting(null);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 text-slate-700 pb-20">
      
      {/* DELETE MODAL */}
      {isDeleting && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <AlertTriangle size={40} />
            </div>
            <p className="font-black text-xl text-slate-900 leading-tight">Delete {activeTab.slice(0, -1)}?</p>
            <div className="flex gap-4">
              <button onClick={() => setIsDeleting(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold text-slate-500">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-100">
            <Globe size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Geography</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">Manage states and regions</p>
          </div>
        </div>
      </div>

      {/* TABS SWITCHER */}
      <div className="flex bg-white p-1.5 rounded-[25px] border border-slate-100 shadow-sm w-fit">
        {(['States', 'Districts', 'Constituencies'] as GeoTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setNewName(''); setSearchQuery(''); }}
            className={`px-8 py-3 rounded-[20px] font-black text-[10px] uppercase tracking-widest transition-all ${
              activeTab === tab ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ADD STRIP */}
      <div className="bg-white p-3 rounded-[35px] border border-slate-200 shadow-lg flex flex-col lg:flex-row items-stretch gap-4">
        
        {/* Step 1: Parent Selection */}
        {activeTab === 'Districts' && (
          <div className="flex items-center gap-3 flex-1 bg-slate-50 p-3 rounded-2xl border border-slate-100">
            <span className="text-[9px] font-black text-blue-600 uppercase ml-2">State</span>
            <select 
              value={selectedStateId} 
              onChange={e => setSelectedStateId(Number(e.target.value))}
              className="w-full bg-transparent outline-none font-bold text-slate-800 text-sm cursor-pointer"
            >
              <option value={0}>Select State...</option>
              {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {activeTab === 'Constituencies' && (
          <div className="flex items-center gap-3 flex-1 bg-slate-50 p-3 rounded-2xl border border-slate-100">
            <span className="text-[9px] font-black text-emerald-600 uppercase ml-2">Dist</span>
            <select 
              value={selectedDistrictId} 
              onChange={e => { setSelectedDistrictId(Number(e.target.value)); setNewName(''); }}
              className="w-full bg-transparent outline-none font-bold text-slate-800 text-sm cursor-pointer"
            >
              <option value={0}>Select District...</option>
              {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        {/* Step 2: Name Input / Dropdown */}
        <div className="flex items-center gap-4 flex-[2] bg-slate-50 p-3 rounded-2xl border border-slate-100 transition-all focus-within:border-blue-300">
          <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shrink-0">
            {activeTab === 'States' ? <Globe size={18} /> : activeTab === 'Districts' ? <MapPin size={18} /> : <Map size={18} />}
          </div>
          <div className="flex-1">
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">{activeTab.slice(0, -1)} Name</span>
             
             {/* If we have data for selected area, show dropdown. Else, show text input */}
             {activeTab === 'States' ? (
                <select 
                    value={newName} 
                    onChange={e => setNewName(e.target.value)}
                    className="w-full bg-transparent outline-none font-bold text-slate-800 text-sm cursor-pointer"
                >
                    <option value="">Choose State...</option>
                    {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
             ) : activeTab === 'Constituencies' && assemblyOptions.length > 0 ? (
                <select 
                    value={newName} 
                    onChange={e => setNewName(e.target.value)}
                    className="w-full bg-transparent outline-none font-bold text-slate-800 text-sm cursor-pointer"
                >
                    <option value="">Choose Assembly Seat...</option>
                    {assemblyOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    <option value="custom">+ Add Manual Name...</option>
                </select>
             ) : (
                <input 
                    type="text" 
                    value={newName === 'custom' ? '' : newName} 
                    onChange={e => setNewName(e.target.value)} 
                    placeholder={`Type ${activeTab.slice(0, -1)} name...`} 
                    className="w-full bg-transparent outline-none font-bold text-slate-800 placeholder:text-slate-300" 
                />
             )}
          </div>
        </div>

        <button 
          onClick={handleAdd} 
          disabled={!newName || (activeTab === 'Districts' && !selectedStateId) || (activeTab === 'Constituencies' && !selectedDistrictId)} 
          className="bg-blue-600 text-white px-12 rounded-2xl font-black text-xs hover:bg-slate-900 disabled:opacity-30 transition-all uppercase tracking-widest shadow-xl shadow-blue-100 active:scale-95 min-h-[56px] lg:min-h-0"
        >
          Add
        </button>
      </div>

      {/* SEARCH & LIST HEADER */}
      <div className="flex items-center justify-between px-2">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2">
            <Building2 size={14} className="text-blue-500" /> {activeTab} 
        </h3>
        <div className="relative group">
            <Search className="absolute left-3 top-2 text-slate-300 group-focus-within:text-blue-500 transition-colors" size={14} />
            <input 
                type="text" 
                placeholder="Quick search..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-white border border-slate-100 rounded-xl pl-9 pr-4 py-1.5 text-[10px] font-bold outline-none focus:border-blue-200 shadow-sm"
            />
        </div>
      </div>

      {/* DATA GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pb-20">
        {activeTab === 'States' && states.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())).map(s => (
          <div key={s.id} className="bg-white p-6 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-xl transition-all group flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shadow-sm"><Globe size={18} /></div>
              <button onClick={() => setIsDeleting({type: 'States', item: s})} className="p-2 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={18} /></button>
            </div>
            <h4 className="font-black text-slate-900 text-lg tracking-tight mb-4">{s.name}</h4>
            <button onClick={() => {setActiveTab('Districts'); setSelectedStateId(s.id);}} className="mt-auto w-full py-3 bg-slate-50 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:text-blue-600 transition-all">Manage Districts</button>
          </div>
        ))}

        {activeTab === 'Districts' && districts.filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase())).map(d => (
          <div key={d.id} className="bg-white p-6 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-xl transition-all group flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shadow-sm"><MapPin size={18} /></div>
              <button onClick={() => setIsDeleting({type: 'Districts', item: d})} className="p-2 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={18} /></button>
            </div>
            <h4 className="font-black text-slate-900 text-lg tracking-tight mb-1">{d.name}</h4>
            <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-4">{d.stateName}</p>
            <button onClick={() => {setActiveTab('Constituencies'); setSelectedDistrictId(d.id);}} className="mt-auto w-full py-3 bg-slate-50 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:text-indigo-600 transition-all">Manage Seats</button>
          </div>
        ))}

        {activeTab === 'Constituencies' && constituencies.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).map(c => (
          <div key={c.id} className="bg-white p-6 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-xl transition-all group flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shadow-sm"><Map size={18} /></div>
              <button onClick={() => setIsDeleting({type: 'Constituencies', item: c})} className="p-2 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={18} /></button>
            </div>
            <h4 className="font-black text-slate-900 text-lg tracking-tight mb-1">{c.name}</h4>
            <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-4">{c.districtName}</p>
            <div className="mt-auto py-2 bg-slate-50 rounded-xl text-[9px] font-black uppercase text-slate-300 text-center">Assembly Active</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 justify-center py-6 text-slate-300 font-bold text-[11px] uppercase tracking-[0.4em]">
        <CheckCircle2 size={14} className="text-emerald-500" /> Geography Data Live
      </div>
    </div>
  );
}