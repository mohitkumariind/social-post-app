"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PostsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin');
  }, [router]);

  return null;
}