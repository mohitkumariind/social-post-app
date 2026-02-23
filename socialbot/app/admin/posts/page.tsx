'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';

// Placeholder data – replace with API/fetch
const posts = [
  { id: 1, title: 'Independence Day Poster', type: 'Image', category: 'Graphics', createdAt: '2024-02-20' },
  { id: 2, title: 'Party Campaign Reel', type: 'Video', category: 'Reels', createdAt: '2024-02-19' },
  { id: 3, title: 'Wishes Template', type: 'Image', category: 'Graphics', createdAt: '2024-02-18' },
];

export default function PostsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Content Library</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Manage all posts and media assets
          </p>
        </div>
        <Link
          href="/admin/posts/new"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          New Post
        </Link>
      </div>
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Title
              </th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Type
              </th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Category
              </th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {posts.map((post) => (
              <tr key={post.id} className="hover:bg-zinc-800/30">
                <td className="px-6 py-4 text-sm font-medium text-white">
                  {post.title}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-400">{post.type}</td>
                <td className="px-6 py-4 text-sm text-zinc-400">{post.category}</td>
                <td className="px-6 py-4 text-sm text-zinc-400">{post.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
