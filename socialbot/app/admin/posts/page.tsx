"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy URL: same management UI as Events. */
export default function PostsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/events');
  }, [router]);

  return null;
}
