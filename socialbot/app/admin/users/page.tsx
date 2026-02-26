"use client";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
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
  
  // --- PAGINATION CONFIG ---
  const ITEMS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(1);

  // --- MOCK DATA ---
  const [users, setUsers] = useState<AppUser[]>([
    { 
      id: 1, 
      name: 'Mohit Sharma', 
      phone: '+91 9876543210', 
      email: 'mohit.meerut@gmail.com',
      party: 'BJP', 
      designation: 'District President', 
      state: 'Uttar Pradesh', 
      district: 'Meerut',
      constituency: 'Meerut Cantt',
      joinDate: '24 Feb 2026',
      dob: '12-05-1988',
      gender: 'Male',
      address: 'House No. 45, Civil Lines, Near Stadium',
      personalFrames: [{ id: 1001, url: 'https://placehold.co/400x500/png?text=Frame+A', uploadDate: '20 Feb 2026' }]
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
        joinDate: '22 Feb 2026',
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
      state: 'Uttar Pradesh',
      district: 'Meerut',
      constituency: 'Meerut South',
      joinDate: '18 Feb 2026',
      dob: '15-08-1990',
      gender: 'Male',
      address: 'Prahlad Nagar, Meerut City',
      personalFrames: []
    }))
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterParty, setFilterParty] = useState('All');
  const [isDeleting, setIsDeleting] = useState<AppUser | null>(null);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [frameToDelete, setFrameToDelete] = useState<UserFrame | null>(null);

  // --- FILTER & SORT LOGIC ---
  const filteredUsers = users
    .filter(u => {
      const matchesSearch = u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.phone.includes(searchQuery);
      const matchesParty = filterParty === 'All' || u.party === filterParty;
      return matchesSearch && matchesParty;
    })
    .sort((a, b) => b.id - a.id);

  // --- PAGINATION ---
  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedUsers = filteredUsers.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterParty]);

  const handleBulkUploadFrames = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && selectedUser) {
      const newFrames: UserFrame[] = Array.from(files).map((file, index) => ({
        id: Date.now() + index,
        url: URL.createObjectURL(file),
        uploadDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      }));

      const updatedUsers = users.map(u => 
        u.id === selectedUser.id ? { ...u, personalFrames: [...newFrames, ...u.personalFrames] } : u
      );

      setUsers(updatedUsers);
      setSelectedUser({ ...selectedUser, personalFrames: [...newFrames, ...selectedUser.personalFrames] });
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePersonalFrame = (frameId: number) => {
    if (!selectedUser) return;
    const updatedFrames = selectedUser.personalFrames.filter(f => f.id !== frameId);
    const updatedUsers = users.map(u => u.id === selectedUser.id ? { ...u, personalFrames: updatedFrames } : u);
    setUsers(updatedUsers);
    setSelectedUser({ ...selectedUser, personalFrames: updatedFrames });
    setFrameToDelete(null);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 text-slate-700 pb-20">
      
      <input type="file" ref={fileInputRef} onChange={handleBulkUploadFrames} className="hidden" multiple accept="image/png" />

      {/* DELETE MODAL */}
      {isDeleting && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 text-center">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><AlertTriangle size={40} /></div>
            <p className="font-black text-xl text-slate-900 leading-tight">Delete User?</p>
            <div className="flex gap-4">
              <button onClick={() => setIsDeleting(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold transition-all">Cancel</button>
              <button onClick={() => {setUsers(users.filter(u => u.id !== isDeleting.id)); setIsDeleting(null);}} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-lg shadow-red-200 transition-all active:scale-95">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* FULL DETAIL MODAL - RE-POSITIONED CLOSE BUTTON */}
      {selectedUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-white rounded-[45px] w-full max-w-5xl shadow-2xl animate-in slide-in-from-bottom-8 overflow-hidden relative">
            
            {/* FIX: CLOSE BUTTON MOVED FURTHER DOWN AND INSIDE */}
            <button 
                onClick={() => setSelectedUser(null)} 
                className="absolute top-12 right-10 z-[130] w-12 h-12 bg-slate-900/90 hover:bg-blue-600 text-white rounded-2xl flex items-center justify-center transition-all shadow-2xl border border-white/20 active:scale-90"
                title="Close Profile"
            >
                <X size={24} strokeWidth={3} />
            </button>

            {/* Modal Header */}
            <div className="bg-slate-900 p-10 text-white">
                <div className="flex items-center gap-6 pr-24"> {/* pr-24 to clear space for the new button position */}
                    <div className="w-24 h-24 bg-blue-600 rounded-[30px] flex items-center justify-center text-white shadow-xl shadow-blue-500/20">
                        <User size={48} />
                    </div>
                    <div>
                        <h2 className="text-4xl font-black tracking-tight leading-none">{selectedUser.name}</h2>
                        <div className="flex items-center gap-4 mt-3">
                            <span className="bg-blue-600 text-[11px] font-black uppercase px-3 py-1 rounded-lg shadow-sm tracking-widest">{selectedUser.party} Member</span>
                            <span className="text-slate-500 font-bold text-xs uppercase tracking-widest">Since {selectedUser.joinDate}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-10 grid grid-cols-1 lg:grid-cols-12 gap-10 max-h-[70vh] overflow-y-auto bg-white">
                <div className="lg:col-span-4 space-y-8 border-r border-slate-100 pr-6">
                    <div className="space-y-6">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono"><Info size={14} className="text-blue-500" /> Member Details</h3>
                        <div className="space-y-5">
                            <div className="flex items-center gap-4 group">
                                <div className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-all"><Phone size={18} /></div>
                                <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Mobile Number</p><p className="font-bold text-slate-800 tracking-tight">{selectedUser.phone}</p></div>
                            </div>
                            <div className="flex items-center gap-4 group">
                                <div className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-all"><Mail size={18} /></div>
                                <div className="flex-1 min-w-0"><p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Email ID</p><p className="font-bold text-slate-800 truncate tracking-tight">{selectedUser.email}</p></div>
                            </div>
                            <div className="flex items-center gap-4 group">
                                <div className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-all"><MapPin size={18} /></div>
                                <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Constituency</p><p className="font-bold text-slate-800 tracking-tight">{selectedUser.constituency}</p></div>
                            </div>
                        </div>
                    </div>
                    <div className="p-6 bg-slate-50 rounded-[35px] border border-slate-100 shadow-inner">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Home Address</p>
                        <p className="text-sm font-bold text-slate-600 leading-relaxed italic">"{selectedUser.address}"</p>
                    </div>
                </div>

                <div className="lg:col-span-8 space-y-6">
                    <div className="flex items-center justify-between px-2">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono"><History size={14} className="text-blue-500" /> Frame Inventory</h3>
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{selectedUser.personalFrames.length} Items Total</p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 pb-6">
                        {/* BULK UPLOAD BOX */}
                        <div 
                            onClick={() => fileInputRef.current?.click()} 
                            className="aspect-[4/5] bg-white border-4 border-dashed border-slate-200 rounded-[45px] flex flex-col items-center justify-center text-slate-300 cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-all group active:scale-95 shadow-sm"
                        >
                            <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all mb-4 shadow-inner">
                                <Plus size={32} strokeWidth={3} />
                            </div>
                            <p className="font-black uppercase text-[10px] tracking-[0.2em] group-hover:text-blue-600">Bulk Upload</p>
                            <p className="text-[8px] text-slate-300 font-bold uppercase mt-1">Select PNGs</p>
                        </div>
                        {selectedUser.personalFrames.map((frame) => (
                            <div key={frame.id} className="group relative aspect-[4/5] bg-slate-100 rounded-[45px] overflow-hidden border border-slate-100 shadow-md hover:shadow-xl transition-all duration-500">
                                <img src={frame.url} className="w-full h-full object-contain p-6 relative z-10" alt="personal frame" />
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex flex-col justify-end p-6 z-20">
                                    <button onClick={() => removePersonalFrame(frame.id)} className="w-full py-3 bg-rose-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:bg-rose-700 active:scale-95 shadow-xl"><Trash2 size={14} /> Remove</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end">
                <button onClick={() => setSelectedUser(null)} className="px-12 py-4 bg-slate-900 text-white rounded-[20px] font-black text-xs uppercase tracking-[0.2em] shadow-2xl active:scale-95 transition-all">Close Profile</button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-100"><Users size={28} /></div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Users</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">Managing {filteredUsers.length} total users</p>
          </div>
        </div>
      </div>

      {/* SEARCH & FILTER STRIP */}
      <div className="bg-white p-3 rounded-[35px] border border-slate-200 shadow-lg flex flex-col md:flex-row items-stretch gap-4">
        <div className="flex items-center gap-4 flex-[2] bg-slate-50 p-3 rounded-2xl border border-slate-100 transition-all focus-within:border-blue-300">
          <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shrink-0 shadow-md"><Search size={20} /></div>
          <div className="flex-1 text-sm">
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5 tracking-widest">Find User</span>
             <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search name or phone..." className="w-full bg-transparent outline-none font-bold text-slate-800" />
          </div>
        </div>
        <div className="flex items-center gap-4 flex-1 bg-slate-50 p-3 rounded-2xl border border-slate-100 transition-all focus-within:border-blue-300">
          <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0"><Filter size={20} /></div>
          <div className="flex-1 text-sm">
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Party Filter</span>
             <select value={filterParty} onChange={e => setFilterParty(e.target.value)} className="w-full bg-transparent outline-none font-bold text-slate-800 text-sm cursor-pointer appearance-none">
               <option value="All">All Parties</option>
               <option value="BJP">BJP</option>
               <option value="INC">INC</option>
               <option value="SP">SP</option>
             </select>
          </div>
        </div>
      </div>

      {/* PAGINATED USER GRID (Latest First) */}
      <div className="space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            {paginatedUsers.map((user) => (
            <div key={user.id} className="bg-white p-7 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col relative overflow-hidden border-b-4 border-b-transparent hover:border-b-blue-500">
                <div className="absolute top-6 right-6">
                    <button onClick={() => setIsDeleting(user)} className="p-2 text-slate-200 hover:text-red-500 rounded-xl transition-all"><Trash2 size={18} /></button>
                </div>
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner"><User size={24} /></div>
                    <div>
                        <h4 className="font-black text-slate-900 text-base leading-tight tracking-tight">{user.name}</h4>
                        <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mt-1">{user.party}</p>
                    </div>
                </div>
                <div className="space-y-2 mb-6">
                    <div className="flex items-center gap-3 text-slate-500 text-xs font-bold font-mono"><Phone size={14} className="text-slate-300" /> {user.phone}</div>
                    <div className="flex items-center gap-3 text-slate-500 text-xs font-bold"><MapPin size={14} className="text-slate-300" /> {user.district}</div>
                </div>
                <button 
                    onClick={() => setSelectedUser(user)}
                    className="mt-auto w-full py-4 bg-slate-50 rounded-2xl text-[9px] font-black uppercase tracking-widest text-blue-600 hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2 shadow-inner active:scale-95"
                >
                    Details & Assets <ExternalLink size={14} />
                </button>
            </div>
            ))}
        </div>

        {/* PAGINATION CONTROL UI */}
        {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-6 rounded-[35px] border border-slate-100 shadow-sm">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Showing <span className="text-blue-600">{startIndex + 1}</span> to <span className="text-blue-600">{Math.min(startIndex + ITEMS_PER_PAGE, filteredUsers.length)}</span> of {filteredUsers.length} users
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="w-10 h-10 bg-slate-50 text-slate-400 rounded-xl flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-slate-50 disabled:hover:text-slate-400"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(num => (
                        <button
                            key={num}
                            onClick={() => setCurrentPage(num)}
                            className={`w-10 h-10 rounded-xl font-black text-xs transition-all ${
                                currentPage === num 
                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' 
                                : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                            }`}
                        >
                            {num}
                        </button>
                    ))}

                    <button 
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className="w-10 h-10 bg-slate-50 text-slate-400 rounded-xl flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-slate-50 disabled:hover:text-slate-400"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>
        )}

        {filteredUsers.length === 0 && (
          <div className="py-20 text-center bg-slate-50/50 rounded-[40px] border border-dashed border-slate-200 text-slate-400 font-bold uppercase tracking-widest text-sm italic">
            Bhai, is search se koi user nahi mila.
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 justify-center py-6 text-slate-300 font-bold text-[11px] uppercase tracking-[0.4em]">
        <CheckCircle2 size={14} className="text-emerald-500" /> Secure User Management System
      </div>
    </div>
  );
}