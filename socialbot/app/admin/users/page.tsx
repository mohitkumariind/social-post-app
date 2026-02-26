"use client";
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Flag,
  Globe,
  History,
  Info,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  X
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

// --- TYPES ---
interface UserFrame {
  id: number;
  url: string;
  uploadDate: string;
}

interface AppUser {
  id: number;
  name: string;
  phone: string;
  email: string;
  party: string;
  designation: string;
  state: string;
  district: string;
  constituency: string;
  joinDate: string;
  dob: string;
  gender: string;
  address: string;
  personalFrames: UserFrame[]; 
}

export default function UserManagement() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ITEMS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(1);

  // --- MOCK DATA ---
  const [users, setUsers] = useState<AppUser[]>([
    { 
      id: 1, 
      name: 'Mohit Sharma', 
      phone: '+91 9540477457', 
      email: 'mohit.meerut@gmail.com',
      party: 'BJP', 
      designation: 'District President', 
      state: 'Uttar Pradesh', 
      district: 'Meerut',
      constituency: 'Meerut Cantt',
      joinDate: '27 Feb 2026',
      dob: '12-05-1988',
      gender: 'Male',
      address: 'House No. 45, Civil Lines, Near Stadium',
      personalFrames: [{ id: 1001, url: 'https://placehold.co/400x500/png?text=Frame+A', uploadDate: '27 Feb 2026' }]
    },
    { 
        id: 2, 
        name: 'Rahul Verma', 
        phone: '+91 8888877777', 
        email: 'rahul.v@outlook.com',
        party: 'INC', 
        designation: 'Youth Leader', 
        state: 'Maharashtra', 
        district: 'Mumbai',
        constituency: 'South Mumbai',
        joinDate: '26 Feb 2026',
        dob: '05-11-1992',
        gender: 'Male',
        address: 'Flat 202, Marine Drive Residency',
        personalFrames: []
    },
    ...Array.from({ length: 25 }, (_, i) => ({
      id: i + 3,
      name: `Karyakarta ${i + 3}`,
      phone: `+91 90000100${i < 10 ? '0'+i : i}`,
      email: `user${i+3}@socialbot.in`,
      party: i % 2 === 0 ? 'BJP' : 'INC',
      designation: 'Active Member',
      state: i % 2 === 0 ? 'Uttar Pradesh' : 'Maharashtra',
      district: i % 2 === 0 ? 'Meerut' : 'Mumbai',
      constituency: i % 2 === 0 ? 'Meerut South' : 'South Mumbai',
      joinDate: '27 Feb 2026',
      dob: '15-08-1990',
      gender: 'Male',
      address: 'Prahlad Nagar, City Center',
      personalFrames: []
    }))
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterParty, setFilterParty] = useState('All');
  const [filterState, setFilterState] = useState('All');
  const [filterDistrict, setFilterDistrict] = useState('All');
  const [filterConstituency, setFilterConstituency] = useState('All');
  const [filterNewUsers, setFilterNewUsers] = useState('All');

  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [isDeleting, setIsDeleting] = useState<AppUser | null>(null);

  // --- DYNAMIC FILTER OPTIONS ---
  const states = Array.from(new Set(users.map(u => u.state)));
  const districts = Array.from(new Set(users.filter(u => filterState === 'All' || u.state === filterState).map(u => u.district)));
  const constituencies = Array.from(new Set(users.filter(u => filterDistrict === 'All' || u.district === filterDistrict).map(u => u.constituency)));

  // --- FILTER LOGIC ---
  const filteredUsers = users
    .filter(u => {
      const matchesSearch = u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.phone.includes(searchQuery);
      const matchesParty = filterParty === 'All' || u.party === filterParty;
      const matchesState = filterState === 'All' || u.state === filterState;
      const matchesDistrict = filterDistrict === 'All' || u.district === filterDistrict;
      const matchesConstituency = filterConstituency === 'All' || u.constituency === filterConstituency;
      const matchesNewUsers = filterNewUsers === 'All' || u.joinDate === '27 Feb 2026';
      return matchesSearch && matchesParty && matchesState && matchesDistrict && matchesConstituency && matchesNewUsers;
    })
    .sort((a, b) => b.id - a.id);

  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedUsers = filteredUsers.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterParty, filterState, filterDistrict, filterConstituency, filterNewUsers]);

  const handleBulkUploadFrames = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && selectedUser) {
      const newFrames: UserFrame[] = Array.from(files).map((file, index) => ({
        id: Date.now() + index,
        url: URL.createObjectURL(file),
        uploadDate: '27 Feb 2026'
      }));
      const updatedUsers = users.map(u => u.id === selectedUser.id ? { ...u, personalFrames: [...newFrames, ...u.personalFrames] } : u);
      setUsers(updatedUsers);
      setSelectedUser({ ...selectedUser, personalFrames: [...newFrames, ...selectedUser.personalFrames] });
    }
  };

  const removePersonalFrame = (frameId: number) => {
    if (!selectedUser) return;
    const updatedFrames = selectedUser.personalFrames.filter(f => f.id !== frameId);
    const updatedUsers = users.map(u => u.id === selectedUser.id ? { ...u, personalFrames: updatedFrames } : u);
    setUsers(updatedUsers);
    setSelectedUser({ ...selectedUser, personalFrames: updatedFrames });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 text-slate-700 pb-20">
      
      <input type="file" ref={fileInputRef} onChange={handleBulkUploadFrames} className="hidden" multiple accept="image/png" />

      {/* DELETE MODAL */}
      {isDeleting && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full space-y-6 shadow-2xl text-center">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto"><AlertTriangle size={40} /></div>
            <p className="font-black text-xl text-slate-900">Delete User?</p>
            <div className="flex gap-4">
              <button onClick={() => setIsDeleting(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
              <button onClick={() => {setUsers(users.filter(u => u.id !== isDeleting.id)); setIsDeleting(null);}} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-lg shadow-red-200 transition-all active:scale-95">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* USER PROFILE MODAL */}
      {selectedUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-white rounded-[45px] w-full max-w-5xl shadow-2xl overflow-hidden relative">
            <button onClick={() => setSelectedUser(null)} className="absolute top-8 right-8 z-[130] w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-blue-600 transition-all shadow-xl"><X size={24} /></button>
            <div className="bg-slate-900 p-10 text-white flex items-center gap-6">
                <div className="w-24 h-24 bg-blue-600 rounded-[30px] flex items-center justify-center text-white shadow-xl shadow-blue-500/20"><User size={48} /></div>
                <div>
                    <h2 className="text-4xl font-black tracking-tight leading-none">{selectedUser.name}</h2>
                    <div className="flex items-center gap-4 mt-3">
                        <span className="bg-blue-600 text-[11px] font-black uppercase px-3 py-1 rounded-lg tracking-widest">{selectedUser.party} Member</span>
                        <span className="text-slate-500 font-bold text-xs uppercase tracking-widest italic">Since {selectedUser.joinDate}</span>
                    </div>
                </div>
            </div>
            <div className="p-10 grid grid-cols-1 lg:grid-cols-12 gap-10 max-h-[60vh] overflow-y-auto bg-white">
                <div className="lg:col-span-4 space-y-8 border-r border-slate-100 pr-6">
                    <div className="space-y-6">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono"><Info size={14} className="text-blue-500" /> Member Info</h3>
                        <div className="space-y-4">
                            <div className="flex items-center gap-4"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400"><Phone size={18} /></div><p className="font-bold text-slate-800 tracking-tight">{selectedUser.phone}</p></div>
                            <div className="flex items-center gap-4"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400"><Mail size={18} /></div><p className="font-bold text-slate-800 truncate tracking-tight">{selectedUser.email}</p></div>
                            <div className="flex items-center gap-4"><div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400"><MapPin size={18} /></div><p className="font-bold text-slate-800 tracking-tight">{selectedUser.constituency}</p></div>
                        </div>
                    </div>
                    <div className="p-6 bg-slate-50 rounded-[30px] border border-slate-100 shadow-inner"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Address</p><p className="text-sm font-bold text-slate-600 leading-relaxed italic">"{selectedUser.address}"</p></div>
                </div>

                {/* UPDATED: USER FRAMES SECTION */}
                <div className="lg:col-span-8 space-y-6">
                    <div className="flex items-center justify-between px-2">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono"><History size={14} className="text-blue-500" /> User Frames</h3>
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{selectedUser.personalFrames.length} Frames</p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 pb-4">
                        {/* UPLOAD FRAME BOX */}
                        <div onClick={() => fileInputRef.current?.click()} className="aspect-[4/5] bg-white border-4 border-dashed border-slate-200 rounded-[40px] flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all active:scale-95 group shadow-sm">
                            <div className="w-12 h-12 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all mb-3 shadow-inner"><Plus size={24} strokeWidth={3} /></div>
                            <p className="font-black uppercase text-[10px] tracking-widest group-hover:text-blue-600">Upload Frames</p>
                            <p className="text-[8px] text-slate-300 font-bold uppercase mt-1">Select PNG Assets</p>
                        </div>
                        {selectedUser.personalFrames.map((frame) => (
                            <div key={frame.id} className="group relative aspect-[4/5] bg-slate-100 rounded-[40px] overflow-hidden border border-slate-100 shadow-sm transition-all hover:shadow-xl">
                                <img src={frame.url} className="w-full h-full object-contain p-4 relative z-10" alt="frame" />
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex flex-col justify-end p-6 z-20">
                                    <button onClick={() => removePersonalFrame(frame.id)} className="w-full py-3 bg-rose-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-xl hover:bg-rose-700 active:scale-95"><Trash2 size={14} /> Remove Frame</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end"><button onClick={() => setSelectedUser(null)} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl active:scale-95 transition-all">Close Profile</button></div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-100"><Users size={28} /></div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">User Management</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">Current View: {filteredUsers.length} Filtered Members</p>
          </div>
        </div>
      </div>

      {/* ADVANCED FILTERS */}
      <div className="bg-white p-5 rounded-[40px] border border-slate-200 shadow-lg space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex items-center gap-4 flex-[2] bg-slate-50 p-4 rounded-2xl border border-slate-100 focus-within:border-blue-300 transition-all">
            <Search size={20} className="text-slate-400" />
            <div className="flex-1">
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Global Search</span>
               <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Name or phone..." className="w-full bg-transparent outline-none font-bold text-slate-800" />
            </div>
          </div>
          <div className="flex items-center gap-4 flex-1 bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <Calendar size={20} className="text-emerald-500" />
            <div className="flex-1">
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Registration Status</span>
               <select value={filterNewUsers} onChange={e => setFilterNewUsers(e.target.value)} className="w-full bg-transparent outline-none font-bold text-slate-800 text-sm">
                 <option value="All">All Time</option>
                 <option value="Today">Joined Today</option>
               </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center gap-3">
            <Flag size={18} className="text-blue-600" />
            <div className="flex-1 text-xs">
              <span className="text-[9px] font-black text-slate-400 uppercase block">Political Party</span>
              <select value={filterParty} onChange={e => setFilterParty(e.target.value)} className="w-full bg-transparent outline-none font-bold text-slate-800">
                <option value="All">All Parties</option>
                <option value="BJP">BJP</option>
                <option value="INC">INC</option>
              </select>
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center gap-3">
            <Globe size={18} className="text-purple-600" />
            <div className="flex-1 text-xs">
              <span className="text-[9px] font-black text-slate-400 uppercase block">State Jurisdiction</span>
              <select value={filterState} onChange={e => {setFilterState(e.target.value); setFilterDistrict('All');}} className="w-full bg-transparent outline-none font-bold text-slate-800">
                <option value="All">All States</option>
                {states.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center gap-3">
            <MapPin size={18} className="text-orange-500" />
            <div className="flex-1 text-xs">
              <span className="text-[9px] font-black text-slate-400 uppercase block">District / Unit</span>
              <select value={filterDistrict} onChange={e => {setFilterDistrict(e.target.value); setFilterConstituency('All');}} className="w-full bg-transparent outline-none font-bold text-slate-800">
                <option value="All">All Districts</option>
                {districts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center gap-3">
            <Filter size={18} className="text-slate-600" />
            <div className="flex-1 text-xs">
              <span className="text-[9px] font-black text-slate-400 uppercase block">Assembly Seat</span>
              <select value={filterConstituency} onChange={e => setFilterConstituency(e.target.value)} className="w-full bg-transparent outline-none font-bold text-slate-800">
                <option value="All">All Constituencies</option>
                {constituencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* USER LIST GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
        {paginatedUsers.map((user) => (
          <div key={user.id} className="bg-white p-7 rounded-[45px] border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col relative overflow-hidden border-b-4 border-b-transparent hover:border-b-blue-600">
            <div className="absolute top-6 right-6">
              <button onClick={() => setIsDeleting(user)} className="p-2 text-slate-200 hover:text-red-500 transition-all"><Trash2 size={18} /></button>
            </div>
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner"><User size={24} /></div>
              <div>
                <h4 className="font-black text-slate-900 text-base leading-tight tracking-tight">{user.name}</h4>
                <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mt-1">{user.party}</p>
              </div>
            </div>
            <div className="space-y-2 mb-6 text-xs font-bold text-slate-500">
              <div className="flex items-center gap-3"><Phone size={14} className="text-slate-300" /> {user.phone}</div>
              <div className="flex items-center gap-3"><MapPin size={14} className="text-slate-300" /> {user.district}</div>
            </div>
            <button onClick={() => setSelectedUser(user)} className="mt-auto w-full py-4 bg-slate-50 rounded-2xl text-[9px] font-black uppercase tracking-widest text-blue-600 hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2 active:scale-95 shadow-inner">Profile & Frames <ExternalLink size={14} /></button>
          </div>
        ))}
      </div>

      {/* PAGINATION UI */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-6 rounded-[35px] border border-slate-100 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Showing Page {currentPage} of {totalPages}</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all disabled:opacity-20"><ChevronLeft size={18} /></button>
            <button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all disabled:opacity-20"><ChevronRight size={18} /></button>
          </div>
        </div>
      )}

      {filteredUsers.length === 0 && (
        <div className="py-20 text-center bg-slate-50 rounded-[40px] border-2 border-dashed border-slate-100">
          <p className="text-slate-400 font-black uppercase tracking-widest text-sm italic">Bhai, is criteria mein koi user nahi mila.</p>
        </div>
      )}
    </div>
  );
}