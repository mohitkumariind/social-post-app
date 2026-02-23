'use client';

import { useState } from 'react';
import { Upload, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';

export default function NewPostPage() {
  const [captions, setCaptions] = useState<string[]>(['']);

  const addCaption = () => setCaptions((prev) => [...prev, '']);
  const removeCaption = (i: number) =>
    setCaptions((prev) => prev.filter((_, idx) => idx !== i));
  const updateCaption = (i: number, val: string) =>
    setCaptions((prev) => prev.map((c, idx) => (idx === i ? val : c)));

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <Link
          href="/admin/posts"
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          ← Back to Posts
        </Link>
        <h2 className="mt-2 text-2xl font-bold text-white">New Post</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Upload media and add caption variants for the app
        </p>
      </div>
      <form className="space-y-6">
        {/* Media Upload */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-sm font-medium text-zinc-300">Media</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Image (4:5 or 9:16) or Video (9:16)
          </p>
          <label className="mt-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-700 bg-zinc-800/30 py-12 transition-colors hover:border-zinc-600 cursor-pointer">
            <Upload className="h-10 w-10 text-zinc-500" strokeWidth={1.5} />
            <span className="mt-2 text-sm text-zinc-400">
              Click to upload or drag and drop
            </span>
            <input type="file" className="hidden" accept="image/*,video/*" />
          </label>
        </div>
        {/* Caption Variants */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">
                Caption Variants
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                Add multiple captions for users to copy
              </p>
            </div>
            <button
              type="button"
              onClick={addCaption}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Add
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {captions.map((cap, i) => (
              <div
                key={i}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={cap}
                  onChange={(e) => updateCaption(i, e.target.value)}
                  placeholder={`Caption ${i + 1}`}
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => removeCaption(i)}
                  className="rounded-lg border border-zinc-700 p-2.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                  disabled={captions.length === 1}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Create Post
          </button>
          <Link
            href="/admin/posts"
            className="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
