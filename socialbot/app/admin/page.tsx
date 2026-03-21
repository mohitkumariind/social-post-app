"use client";
import {
  Activity,
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Flag,
  HardDrive,
  Layers,
  Layout,
  TrendingUp,
  Users
} from 'lucide-react';
import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';

// --- TYPES FOR TS ---
interface PostPerformance {
  id: number;
  title: string;
  reach: string;
  shares: string;
  date: string;
}

interface GeoReport {
  label: string;
  value: string;
  sub: string;
}

interface AppHealthStat {
  id: number;
  label: string;
  value: string;
  subText: string;
  icon: React.ReactNode;
  color: string;
}

interface SecondaryStat {
  id: number;
  label: string;
  value: string;
  subText: string;
  icon: React.ReactNode;
  color: string;
}

interface UpcomingEvent {
  id: number;
  name: string;
  date: string;
  color: string;
}

export default function Dashboard() {
  const [postPage, setPostPage] = useState(1);

  // 1. TOP STATS (5 Metrics as requested)
  const topStats = [
    { id: 1, label: 'Total Users', value: '12,840', color: 'bg-blue-600', shadow: 'shadow-blue-100' },
    { id: 2, label: 'New User Today', value: '+450', color: 'bg-emerald-600', shadow: 'shadow-emerald-100' },
    { id: 3, label: 'Active User Daily', value: '3,210', color: 'bg-orange-500', shadow: 'shadow-orange-100' },
    { id: 4, label: 'Active User Monthly', value: '8,400', color: 'bg-indigo-600', shadow: 'shadow-indigo-100' },
    { id: 5, label: 'Inactive Users 30 Days', value: '1,120', color: 'bg-red-600', shadow: 'shadow-red-100' },
  ];

  // 2. APP HEALTH (3 Metrics as requested)
  const appHealthStats: AppHealthStat[] = [
    { id: 1, label: 'System Stability', value: '99.9%', subText: 'Crash-Free Sessions', icon: <Activity className="text-emerald-600" size={24} />, color: 'bg-emerald-50' },
    { id: 2, label: 'User Engagement', value: '4m 12s', subText: 'Avg. Session Time', icon: <TrendingUp className="text-blue-600" size={24} />, color: 'bg-blue-50' },
    { id: 3, label: 'Resource Usage', value: '1.2 TB', subText: 'Cloud Storage Used', icon: <HardDrive className="text-orange-600" size={24} />, color: 'bg-orange-50' },
  ];

  const postsPerformance: PostPerformance[] = [
    { id: 1, title: 'Holi Mubarak Frame', reach: '45,200', shares: '12,400', date: 'Feb 24' },
    { id: 2, title: 'Ambedkar Jayanti Post', reach: '38,100', shares: '10,210', date: 'Feb 22' },
    { id: 3, title: 'Good Morning Quote', reach: '22,050', shares: '8,050', date: 'Feb 21' },
    { id: 4, title: 'Joining Campaign', reach: '18,400', shares: '5,200', date: 'Feb 20' },
    { id: 5, title: 'Vikas Reporting', reach: '12,900', shares: '3,100', date: 'Feb 19' },
  ];

  const geoReport: GeoReport[] = [
    { label: 'Top State', value: 'Uttar Pradesh', sub: '8,400 Users' },
    { label: 'Top District', value: 'Meerut', sub: '2,400 Users' },
    { label: 'Top Loksabha', value: 'Lucknow', sub: '1,200 Users' },
    { label: 'Top Assembly', value: 'Cantt', sub: '450 Users' },
    { label: 'Top Party', value: 'BJP', sub: '6,200 Users' },
  ];

  const secondaryStats: SecondaryStat[] = [
    { id: 1, label: 'Active Parties', value: '12', subText: 'Registered Groups', icon: <Flag className="text-indigo-600" size={28} />, color: 'border-indigo-100' },
    { id: 2, label: 'Active Assembly', value: '403', subText: 'Operational Seats', icon: <Layers className="text-blue-600" size={28} />, color: 'border-blue-100' },
  ];

  const upcomingEvents: UpcomingEvent[] = [
    { id: 1, name: 'Ambedkar Jayanti', date: '14 April', color: 'border-orange-500' },
    { id: 2, name: 'Ram Navami', date: '16 April', color: 'border-red-500' },
    { id: 3, name: 'Labour Day', date: '01 May', color: 'border-blue-500' },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20 text-slate-700">
      
      {/* HEADER */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">SocialBot Dashboard</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-3 leading-none">Live Performance Metrics</p>
        </div>
        <div className="hidden md:flex bg-white px-6 py-3 rounded-2xl border border-slate-100 shadow-sm items-center gap-3">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-xs font-black uppercase text-slate-500 tracking-tighter">Live Tracker: 2026</span>
        </div>
      </div>

      {/* 1. TOP STATS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {topStats.map((stat) => (
          <div key={stat.id} className="bg-white p-6 rounded-[35px] border border-slate-100 shadow-sm hover:shadow-md transition-all">
            <div className={`${stat.color} w-10 h-10 rounded-xl flex items-center justify-center text-white mb-4 shadow-lg ${stat.shadow}`}>
              <Users size={20} />
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-tight">{stat.label}</p>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{stat.value}</h2>
          </div>
        ))}
      </div>

      {/* 2. MIDDLE SECTION: CONTENT & GEO REPORT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-[40px] border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          <div className="p-8 border-b border-slate-50 flex justify-between items-center">
             <div className="flex items-center gap-3">
                <BarChart3 className="text-blue-600" />
                <h3 className="font-black text-slate-900 text-lg">Live Content Reach</h3>
             </div>
             <div className="flex gap-2">
                <button onClick={() => setPostPage(1)} className="p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"><ChevronLeft size={16}/></button>
                <button onClick={() => setPostPage(1)} className="p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"><ChevronRight size={16}/></button>
             </div>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                <th className="px-8 py-4">Post Title</th>
                <th className="px-8 py-4 text-center">Reach</th>
                <th className="px-8 py-4 text-center">Shares</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {postsPerformance.map((post) => (
                <tr key={post.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-5 font-bold text-slate-800">{post.title}</td>
                  <td className="px-8 py-5 text-center font-black text-slate-500">{post.reach}</td>
                  <td className="px-8 py-5 text-center">
                    <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-black">{post.shares}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-slate-900 rounded-[40px] p-8 text-white shadow-2xl flex flex-col">
          <div className="flex items-center gap-3 mb-8">
            <Layout className="text-blue-400" size={20} />
            <h3 className="font-black text-lg uppercase tracking-tight leading-none">Geography Report</h3>
          </div>
          <div className="space-y-4 flex-1">
            {geoReport.map((item) => (
              <div key={item.label} className="bg-white/5 p-5 rounded-[25px] border border-white/5 transition-all hover:bg-white/10">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">{item.label}</p>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-200">{item.value}</span>
                  <span className="bg-blue-500/10 text-blue-400 px-3 py-1 rounded-lg text-[10px] font-black">{item.sub}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. APP HEALTH MONITORING (3 Metrics above Pipeline) */}
      <div className="space-y-4 pt-4">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] px-2 flex items-center gap-2">
           App Health Monitoring
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {appHealthStats.map((item) => (
            <div key={item.id} className="bg-white p-7 rounded-[40px] border border-slate-100 shadow-sm flex items-center gap-6 group hover:shadow-md transition-all">
              <div className={`${item.color} w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                {item.icon}
              </div>
              <div>
                <h4 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-1">{item.value}</h4>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{item.label}</p>
                <p className="text-[9px] font-bold text-slate-300 uppercase leading-none">{item.subText}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. ACTIVE PARTY & ASSEMBLY SUMMARY */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
        {secondaryStats.map((item) => (
          <div key={item.id} className={`bg-white p-8 rounded-[40px] border-2 ${item.color} shadow-sm flex items-center justify-between group hover:shadow-xl transition-all`}>
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 bg-slate-50 rounded-[24px] flex items-center justify-center group-hover:scale-110 transition-transform">
                {item.icon}
              </div>
              <div>
                <h3 className="text-4xl font-black text-slate-900 tracking-tighter leading-none mb-1">{item.value}</h3>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{item.label}</p>
              </div>
            </div>
            <p className="text-[10px] font-black text-slate-300 uppercase hidden sm:block">{item.subText}</p>
          </div>
        ))}
      </div>

      {/* 5. UPCOMING PIPELINE */}
      <div className="space-y-4 pt-4">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] px-2 flex items-center gap-2">
          <Calendar size={14} className="text-orange-500" /> Upcoming Event Pipeline
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {upcomingEvents.map((event) => (
            <div key={event.id} className={`bg-white p-6 rounded-[35px] border-l-8 ${event.color} border border-slate-100 shadow-sm flex items-center justify-between group hover:shadow-md transition-all`}>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target Date: {event.date}</p>
                <h4 className="text-lg font-black text-slate-900 leading-tight">{event.name}</h4>
              </div>
              <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-300 group-hover:text-slate-900 transition-colors">
                <ChevronRight size={20} />
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
