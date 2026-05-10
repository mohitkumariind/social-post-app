'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React from 'react';

/**
 * Deep link target for "View Profile" from Leaderboard Management.
 * User Management remains a single-page app; this route gives a stable URL per profile id.
 */
export default function AdminUserByIdPage() {
  const params = useParams();
  const raw = String(params?.id ?? '');

  return (
    <div className="mx-auto max-w-xl space-y-4 text-zinc-200">
      <h1 className="text-lg font-semibold text-white">User profile</h1>
      <p className="text-sm text-zinc-400">
        Profile id <span className="font-mono text-zinc-200">{raw}</span>. Open User Management and
        paste this id into search, or pick the user from the list.
      </p>
      <Link href="/admin/users" className="inline-flex text-sm font-medium text-blue-400 hover:text-blue-300">
        ← Back to User Management
      </Link>
    </div>
  );
}
