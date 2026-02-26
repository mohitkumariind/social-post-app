"use client";
import {
    AlertTriangle,
    ArrowLeft,
    Calendar,
    CheckCircle2,
    ChevronRight,
    FileText,
    Folder,
    Image as ImageIcon,
    Layers,
    MessageSquare,
    Plus,
    PlusCircle,
    Trash2,
    Video
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

// --- TYPES ---
interface Post {
  id: string;
  url: string;
  type: 'video' | 'image';
  name: string;
}

interface CampaignEvent {
  id: number;
  name: string;
  start: string;
  end: string;
  posts: Post[];
  captions: string[]; // App ke liye captions ki list
}

export default function App() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [view, setView] = useState<'list' | 'gallery'>('list');
  const [selectedEvent, setSelectedEvent] = useState<CampaignEvent | null>(null);
  const [postToDelete, setPostToDelete] = useState<Post | null>(null);
  const [captionToDelete, setCaptionToDelete] = useState<number | null>(null); 
  const [newCaptionText, setNewCaptionText] = useState(''); 
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000); 
    return () => clearInterval(timer);
  }, []);

  const [events, setEvents] = useState<CampaignEvent[]>([
    { 
      id: 1, 
      name: 'Republic Day 2026', 
      start: '2026-02-24T00:00:00', 
      end: '2026-02-24T23:59:59', 
      posts: [],
      captions: ["Gantantra Diwas ki shubhkamnaye! 🙏", "Jai Hind, Jai Bharat! 🇮🇳"] 
    }
  ]);
  
  const [newName, setNewName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isDeleting, setIsDeleting] = useState<CampaignEvent | null>(null);

  const getStatus = (sDate: string, eDate: string) => {
    const now = currentTime.getTime();
    const s = new Date(sDate).getTime();
    const e = new Date(eDate).getTime();
    if (now < s) return { id: 'soon', label: 'Upcoming', color: 'bg-blue-50 text-blue-600' };
    if (now >= s && now <= e) return { id: 'live', label: 'Live Now', color: 'bg-green-50 text-green-600', pulse: true };
    return { id: 'done', label: 'Expired', color: 'bg-slate-100 text-slate-400' };
  };

  const createEvent = () => {
    if (newName && startDate && endDate) {
      const ev: CampaignEvent = { id: Date.now(), name: newName, start: `${startDate}T00:00:00`, end: `${endDate}T23:59:59`, posts: [], captions: [] };
      setEvents([ev, ...events]);
      setNewName(''); setStartDate(''); setEndDate('');
    }
  };

  const openEvent = (ev: CampaignEvent) => {
    setSelectedEvent(ev);
    setView('gallery');
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selectedEvent) return;

    const newPosts: Post[] = Array.from(files).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      url: URL.createObjectURL(file),
      type: file.type.startsWith('video') ? 'video' : 'image',
      name: file.name
    }));

    const updated = events.map(ev => ev.id === selectedEvent.id ? { ...ev, posts: [...newPosts, ...ev.posts] } : ev);
    setEvents(updated);
    setSelectedEvent({ ...selectedEvent, posts: [...newPosts, ...selectedEvent.posts] });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addCaptionToList = () => {
    if (!selectedEvent || !newCaptionText.trim()) return;
    const updatedCaptions = [...selectedEvent.captions, newCaptionText.trim()];
    const updatedEvents = events.map(ev => 
      ev.id === selectedEvent.id ? { ...ev, captions: updatedCaptions } : ev
    );
    setEvents(updatedEvents);
    setSelectedEvent({ ...selectedEvent, captions: updatedCaptions });
    setNewCaptionText('');
  };

  const confirmDeleteCaption = () => {
    if (!selectedEvent || captionToDelete === null) return;
    const updatedCaptions = selectedEvent.captions.filter((_, i) => i !== captionToDelete);
    const updatedEvents = events.map(ev => 
      ev.id === selectedEvent.id ? { ...ev, captions: updatedCaptions } : ev
    );
    setEvents(updatedEvents);
    setSelectedEvent({ ...selectedEvent, captions: updatedCaptions });
    setCaptionToDelete(null);
  };

  const removePost = () => {
    if (!selectedEvent || !postToDelete) return;
    const filtered = selectedEvent.posts.filter(p => p.id !== postToDelete.id);
    const updated = events.map(ev => ev.id === selectedEvent.id ? { ...ev, posts: filtered } : ev);
    setEvents(updated);
    setSelectedEvent({ ...selectedEvent, posts: filtered });
    setPostToDelete(null);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });

  // --- VIEW 1: EVENT LIST ---
  if (view === 'list') {
    return (
      <div className="max-w-6xl mx-auto p-4 space-y-8 animate-in fade-in duration-500 text-slate-700">
        {isDeleting && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
              <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><AlertTriangle size={40} /></div>
              <p className="font-black text-xl text-slate-900">Delete Event?</p>
              <div className="flex gap-4">
                <button onClick={() => setIsDeleting(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
                <button onClick={() => {setEvents(events.filter(e => e.id !== isDeleting.id)); setIsDeleting(null);}} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold">Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* Professional Header Card */}
        <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
              <Layers size={28} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Campaign Hub</h1>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">Manage events and Captions</p>
            </div>
          </div>
        </div>

        {/* Create Event Strip */}
        <div className="bg-white p-3 rounded-[35px] border border-slate-200 shadow-lg flex flex-col lg:flex-row items-stretch gap-4">
             <div className="flex items-center gap-4 flex-[1.5] bg-slate-50 p-3 rounded-2xl border border-slate-100">
                <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shrink-0"><Plus size={20} /></div>
                <div className="flex-1">
                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Event Name</span>
                   <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Independence Day" className="w-full bg-transparent outline-none font-bold text-slate-800" />
                </div>
             </div>
             <div className="flex flex-[2] items-center gap-3">
                <div className="flex flex-col flex-1 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Activation</span>
                   <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent outline-none font-bold text-xs" />
                </div>
                <div className="flex flex-col flex-1 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                   <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-0.5">Expiry</span>
                   <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent outline-none font-bold text-xs" />
                </div>
             </div>
             <button onClick={createEvent} disabled={!newName || !startDate || !endDate} className="bg-blue-600 text-white px-12 rounded-2xl font-black text-xs hover:bg-slate-900 disabled:opacity-30 transition-all uppercase tracking-widest">Add</button>
        </div>

        <div className="space-y-12 pb-20">
          {['live', 'soon', 'done'].map(st => {
            const items = events.filter(e => getStatus(e.start, e.end).id === st);
            if (items.length === 0) return null;
            return (
              <div key={st} className="space-y-6">
                <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-3 px-2">
                  <div className={`w-2 h-2 rounded-full ${st === 'live' ? 'bg-green-500 animate-ping' : st === 'soon' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                  {st === 'live' ? 'Active Now' : st === 'soon' ? 'Upcoming' : 'Historical'} ({items.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {items.map(ev => {
                    const status = getStatus(ev.start, ev.end);
                    return (
                      <div key={ev.id} className="bg-white p-7 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-2xl transition-all group flex flex-col">
                        <div className="flex justify-between items-start mb-6">
                          <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${status.color}`}>
                            {status.label}
                          </span>
                          <button onClick={() => setIsDeleting(ev)} className="p-2 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16}/></button>
                        </div>
                        <h4 className="font-black text-slate-900 text-xl mb-1">{ev.name}</h4>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-8 flex items-center gap-1.5"><Folder size={12} className="text-blue-500" /> {ev.posts.length} Assets • {ev.captions.length} Captions</p>
                        <button 
                          onClick={() => openEvent(ev)}
                          className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:bg-blue-600 transition-all flex items-center justify-center gap-2 shadow-lg"
                        >
                          Manage <ChevronRight size={16} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    );
  }

  // --- VIEW 2: GALLERY & CAPTION MANAGER ---
  return (
    <div className="max-w-6xl mx-auto p-4 space-y-8 animate-in slide-in-from-bottom-4 text-slate-700 pb-20">
      <input type="file" ref={fileInputRef} onChange={handleUpload} multiple accept="video/*,image/*" className="hidden" />

      {/* Media Delete Popup */}
      {postToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><Trash2 size={40} /></div>
            <p className="font-black text-2xl text-slate-900">Remove Asset?</p>
            <div className="flex gap-4">
              <button onClick={() => setPostToDelete(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
              <button onClick={removePost} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-xl">Yes, Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Caption Delete Popup */}
      {captionToDelete !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><AlertTriangle size={40} /></div>
            <p className="font-black text-xl text-slate-900">Delete Caption?</p>
            <p className="text-slate-400 text-sm font-medium italic">Bhai, ye caption app se hat jayega.</p>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setCaptionToDelete(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
              <button onClick={confirmDeleteCaption} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-xl shadow-red-200">Yes, Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <button onClick={() => setView('list')} className="flex items-center gap-2 text-slate-400 hover:text-blue-600 font-black uppercase text-[10px] tracking-[0.2em] transition-all">
          <ArrowLeft size={20} /> Back
        </button>
        <div className="md:text-right">
          <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none">{selectedEvent?.name}</h2>
          <p className="text-[10px] font-bold text-blue-600 uppercase mt-3 flex md:justify-end items-center gap-2">
            <Calendar size={14} /> {selectedEvent && formatDate(selectedEvent.start)} — {selectedEvent && formatDate(selectedEvent.end)}
          </p>
        </div>
      </div>

      {/* --- ASSET SECTION (TOP) --- */}
      <div className="space-y-6">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] px-2 flex items-center gap-2">
            <ImageIcon size={14} className="text-blue-500" /> Media ({selectedEvent?.posts.length})
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
            <div onClick={() => fileInputRef.current?.click()} className="aspect-[9/16] bg-white border-4 border-dashed border-slate-200 rounded-[45px] flex flex-col items-center justify-center text-slate-300 cursor-pointer hover:border-blue-500 hover:bg-blue-50/30 transition-all group active:scale-95">
                <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all mb-4 shadow-inner"><Plus size={32} strokeWidth={3} /></div>
                <p className="font-black uppercase text-[10px] tracking-widest group-hover:text-blue-600">Media Upload</p>
            </div>

            {selectedEvent?.posts.map((post: Post) => (
            <div key={post.id} className="group animate-in zoom-in-95 relative aspect-[9/16] bg-slate-900 rounded-[45px] overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-500">
                {post.type === 'video' ? <video src={post.url} className="w-full h-full object-cover opacity-80" /> : <img src={post.url} className="w-full h-full object-cover opacity-80" alt="asset" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                    <button onClick={() => setPostToDelete(post)} className="w-10 h-10 bg-rose-500 text-white rounded-2xl flex items-center justify-center shadow-2xl hover:bg-rose-600 active:scale-90 transition-all"><Trash2 size={18} /></button>
                </div>
                <div className="absolute bottom-6 left-6 w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-xl ring-4 ring-blue-600/20">
                    {post.type === 'video' ? <Video size={14} /> : <ImageIcon size={14} />}
                </div>
            </div>
            ))}
        </div>
      </div>

      {/* --- CAPTION MANAGER (BOTTOM) --- */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm space-y-8">
        <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2">
                <MessageSquare size={14} className="text-blue-500" /> Captions
            </h3>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 flex items-center gap-4 bg-slate-50 p-4 rounded-[25px] border border-slate-100">
                <FileText size={20} className="text-slate-400" />
                <input 
                    type="text" 
                    value={newCaptionText}
                    onChange={(e) => setNewCaptionText(e.target.value)}
                    placeholder="Type a new slogan or greeting..." 
                    className="w-full bg-transparent outline-none font-bold text-slate-800 placeholder:text-slate-300"
                />
            </div>
            <button 
                onClick={addCaptionToList}
                disabled={!newCaptionText.trim()}
                className="bg-slate-900 text-white px-12 rounded-[25px] font-black text-xs hover:bg-blue-600 transition-all uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-20 h-[56px]"
            >
                <PlusCircle size={18} /> Add
            </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedEvent?.captions.map((cap, idx) => (
                <div key={idx} className="flex items-center justify-between bg-white border border-slate-100 p-5 rounded-[25px] group hover:border-blue-200 transition-all shadow-sm">
                    <div className="flex items-start gap-4">
                        <span className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-400 shrink-0">{idx + 1}</span>
                        <p className="font-bold text-slate-700 text-sm leading-relaxed">{cap}</p>
                    </div>
                    <button onClick={() => setCaptionToDelete(idx)} className="p-2.5 text-slate-200 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100">
                        <Trash2 size={16} />
                    </button>
                </div>
            ))}
            {selectedEvent?.captions.length === 0 && (
                <div className="col-span-full py-10 text-center bg-slate-50/50 rounded-[30px] border border-dashed border-slate-200">
                    <p className="text-slate-300 font-bold text-xs uppercase tracking-widest">No captions added</p>
                </div>
            )}
        </div>
      </div>

      <div className="flex items-center gap-3 justify-center py-10 text-slate-300 font-bold text-[11px] uppercase tracking-[0.4em]">
        <CheckCircle2 size={14} className="text-emerald-500" /> Active & Synced
      </div>
    </div>
  );
}