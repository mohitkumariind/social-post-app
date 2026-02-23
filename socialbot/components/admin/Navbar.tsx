'use client';

import { User } from 'lucide-react';

interface NavbarProps {
  title: string;
}

export default function Navbar({ title }: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-6 backdrop-blur">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800">
          <User className="h-4 w-4 text-zinc-400" strokeWidth={2} />
        </div>
        <span className="text-sm text-zinc-400">Admin</span>
      </div>
    </header>
  );
}
