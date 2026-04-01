"use client";
import {
  ArrowLeft,
  CheckCircle2,
  Layers,
  Plus,
  Upload,
  Video
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from "../../../lib/supabase";

export default function ReelUploaderPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'list' | 'add'>('list');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  useEffect(() => {
    const fetchCategories = async () => {
      const { data, error } = await supabase.from('events').select('id, name').order('name');
      if (error) {
        console.warn('fetchCategories error:', error);
        setCategories([]);
        return;
      }
      setCategories((data || []).map((r: { id?: string; name: string }) => ({ id: r.id ?? r.name, name: r.name })));
    };
    fetchCategories().finally(() => setCategoriesLoading(false));
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      setSelectedVideo(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!selectedVideo || !selectedCategory) return;
    setUploading(true);
    setUploadSuccess(false);
    try {
      const ext = selectedVideo.name.toLowerCase().endsWith('.mp4') ? '.mp4' : '.mp4';
      const storagePath = `public/reels/${Date.now()}-${selectedVideo.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

      const { error: uploadErr } = await supabase.storage
        .from('post-images')
        .upload(storagePath, selectedVideo, { upsert: true });

      if (uploadErr) {
        console.warn('Upload error:', uploadErr);
        return;
      }

      const { data: urlData } = supabase.storage.from('post-images').getPublicUrl(storagePath);
      const publicUrl = urlData.publicUrl;

      const { error: insertErr } = await supabase.from('posts').insert({
        image_url: publicUrl,
        video_url: publicUrl,
        category: selectedCategory,
        is_video: true,
        aspect_ratio: '9:16',
        title: selectedVideo.name.replace(/\.[^/.]+$/, ''),
        // `posts.captions` is TEXT storing JSON string.
        captions: '[]',
      });

      if (insertErr) {
        console.warn('DB insert error:', insertErr);
        return;
      }

      setUploadSuccess(true);
      setSelectedVideo(null);
      setPreviewUrl(null);
      setSelectedCategory('');
      setTimeout(() => {
        setUploadSuccess(false);
        setView('list');
      }, 1500);
    } catch (err) {
      console.warn('Reel upload exception:', err);
    } finally {
      setUploading(false);
    }
  };

  const resetForm = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedVideo(null);
    setPreviewUrl(null);
    setSelectedCategory('');
    setView('list');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 text-slate-700 pb-20">
      {/* HEADER */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
            <Video size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Upload Reel</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">Manage reel videos</p>
          </div>
        </div>
        <button
          onClick={() => (view === 'list' ? setView('add') : resetForm())}
          className="bg-slate-900 text-white px-8 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 transition-all shadow-xl shadow-slate-100 flex items-center gap-2"
        >
          {view === 'list' ? <Plus size={18} /> : <ArrowLeft size={18} />}
          {view === 'list' ? 'Add Reel' : 'Back'}
        </button>
      </div>

      {/* VIEW: ADD REEL FORM */}
      {view === 'add' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-4">
          {/* Form Side */}
          <div className="bg-white p-10 rounded-[40px] border border-slate-100 shadow-sm space-y-8">
            <h3 className="text-lg font-black text-slate-900">Reel Details</h3>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Category (Event)</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-blue-500 font-bold transition-all"
                  disabled={categoriesLoading}
                >
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-4 border-dashed border-slate-100 rounded-[35px] p-10 text-center hover:border-blue-500 hover:bg-blue-50/30 transition-all group cursor-pointer"
              >
                <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner">
                  <Upload size={28} />
                </div>
                <p className="font-black text-xs uppercase tracking-widest text-slate-400 group-hover:text-blue-600">Select Video</p>
                <p className="text-[10px] text-slate-300 font-bold mt-1 uppercase">9:16 aspect ratio recommended</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              <button
                onClick={handleUpload}
                disabled={!selectedVideo || !selectedCategory || uploading}
                className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-blue-100 disabled:opacity-30 hover:bg-slate-900 transition-all"
              >
                {uploading ? 'Uploading...' : uploadSuccess ? 'Uploaded!' : 'Upload Reel'}
              </button>
            </div>
          </div>

          {/* Preview Side */}
          <div className="flex flex-col gap-6">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] px-2 flex items-center gap-2">
              <Video size={14} className="text-blue-500" /> Preview
            </h3>
            <div className="aspect-[9/16] max-h-[500px] bg-slate-900 rounded-[45px] overflow-hidden relative shadow-2xl border-8 border-white">
              {previewUrl ? (
                <video
                  src={previewUrl}
                  controls
                  className="w-full h-full object-contain"
                  playsInline
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-white/20 font-black uppercase tracking-widest text-xs">Select video to preview</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: LIST (EMPTY STATE FOR NOW) */}
      {view === 'list' && (
        <div className="space-y-8 animate-in fade-in">
          <div className="bg-white p-12 rounded-[40px] border border-slate-100 shadow-sm text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Layers size={40} className="text-slate-300" />
            </div>
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center justify-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-500" /> Reel Upload
            </h3>
            <p className="text-slate-500 font-bold mt-2 text-sm">Click &quot;Add Reel&quot; to upload a new video</p>
          </div>
        </div>
      )}
    </div>
  );
}
