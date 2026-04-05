'use client';

import { supabase } from '@/lib/supabase';
import { LogOut, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface NavbarProps {
  title: string;
}

export default function Navbar({ title }: NavbarProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.replace('/admin/login');
    router.refresh();
    setSigningOut(false);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-6 backdrop-blur">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800">
          <User className="h-4 w-4 text-zinc-400" strokeWidth={2} />
        </div>
        <span className="text-sm text-zinc-400">Admin</span>
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
          className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" />
          {signingOut ? '…' : 'Sign out'}
        </button>
      </div>
    </header>
  );
}
