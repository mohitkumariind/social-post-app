import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';
import { isCampaignManager, isEditor, isModerator } from '@/lib/admin-gate';
import { canPerformMutation } from '@/lib/rbac/mutation-gateway';

export const STORAGE_UPLOAD_ROLES = [
  'admin',
  'super_admin',
  'moderator',
  'campaign_manager',
  'editor',
] as const;

export type StorageMutationAction = 'storage.upload' | 'storage.delete';

export type StorageAuthRejectBody = {
  error: string;
  step: string;
  reason: string;
  role?: string;
  user_id?: string;
};

export function logStorageAuth(
  phase: string,
  detail: Record<string, unknown> & { ok: boolean }
) {
  console.log('[storage-upload]', phase, detail.ok ? 'OK' : 'FAIL', detail);
}

export function storageAuthJson(body: StorageAuthRejectBody, status: number): NextResponse {
  logStorageAuth('reject', { ok: false, ...body, status });
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** `public/events/<eventId>/...` */
export function parseEventIdFromPostImagesPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'public' && parts[1] === 'events') {
    const id = String(parts[2] ?? '').trim();
    return id.length > 0 ? id : null;
  }
  return null;
}

/** `public/<userId>/...` (user frames) */
export function parseUserIdFromUserFramesPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 'public') {
    const id = String(parts[1] ?? '').trim();
    return id.length > 0 ? id : null;
  }
  return null;
}

type ResolveOk = {
  ok: true;
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
  resourceId: string;
  resourceName: string;
};

type ResolveFail = { ok: false; body: StorageAuthRejectBody; status: number };

async function resolveStorageMutationContext(args: {
  auth: VerifiedAdminAuth;
  admin: SupabaseClient;
  bucket: string;
  path: string;
}): Promise<ResolveOk | ResolveFail> {
  const { auth, admin, bucket, path } = args;
  const base = { role: auth.role, user_id: auth.user.id };

  if (auth.role === 'admin' || auth.role === 'super_admin') {
    return {
      ok: true,
      resource: { target_kind: 'admin' },
      payload: { bucket, path },
      resourceId: path,
      resourceName: `${bucket}:${path}`,
    };
  }

  if (isEditor(auth)) {
    if (bucket !== 'post-images') {
      return {
        ok: false,
        status: 403,
        body: {
          ...base,
          step: 'editor_bucket',
          reason: 'editor_may_only_use_post_images',
          error: 'Editor may only upload to post-images bucket',
        },
      };
    }
    const eventId = parseEventIdFromPostImagesPath(path);
    if (!eventId) {
      return {
        ok: false,
        status: 400,
        body: {
          ...base,
          step: 'editor_path',
          reason: 'path_must_be_public_events_eventId',
          error: 'Invalid path for editor uploads (expected public/events/<eventId>/...)',
        },
      };
    }
    const { data: ev, error: evErr } = await admin
      .from('events')
      .select('id, created_by, created_role, state_id, party_id, party, target_groups, status')
      .eq('id', eventId)
      .maybeSingle();
    if (evErr) {
      return {
        ok: false,
        status: 500,
        body: { ...base, step: 'editor_event_lookup', reason: 'supabase_error', error: evErr.message },
      };
    }
    if (!ev) {
      return {
        ok: false,
        status: 404,
        body: { ...base, step: 'editor_event_lookup', reason: 'event_not_found', error: 'Event not found' },
      };
    }
    return {
      ok: true,
      resource: { target_kind: 'event', ...(ev as Record<string, unknown>) },
      payload: { bucket, path },
      resourceId: eventId,
      resourceName: eventId,
    };
  }

  if (isCampaignManager(auth)) {
    if (bucket !== 'post-images') {
      return {
        ok: false,
        status: 403,
        body: {
          ...base,
          step: 'campaign_manager_bucket',
          reason: 'campaign_manager_post_images_only',
          error: 'campaign_manager can only upload post images',
        },
      };
    }
    const eventId = parseEventIdFromPostImagesPath(path);
    if (!eventId) {
      return {
        ok: false,
        status: 400,
        body: {
          ...base,
          step: 'campaign_manager_path',
          reason: 'path_must_be_public_events_eventId',
          error: 'Invalid path for campaign_manager uploads',
        },
      };
    }
    const { data: ev, error: evErr } = await admin
      .from('events')
      .select('id, created_by, created_role, state_id, party_id, party, target_groups, status')
      .eq('id', eventId)
      .maybeSingle();
    if (evErr) {
      return {
        ok: false,
        status: 500,
        body: {
          ...base,
          step: 'campaign_manager_event_lookup',
          reason: 'supabase_error',
          error: evErr.message,
        },
      };
    }
    if (!ev) {
      return {
        ok: false,
        status: 404,
        body: { ...base, step: 'campaign_manager_event_lookup', reason: 'event_not_found', error: 'Event not found' },
      };
    }
    return {
      ok: true,
      resource: { target_kind: 'event', ...(ev as Record<string, unknown>) },
      payload: { bucket, path },
      resourceId: eventId,
      resourceName: eventId,
    };
  }

  if (isModerator(auth)) {
    if (auth.assigned_state_ids.length === 0) {
      return {
        ok: false,
        status: 403,
        body: {
          ...base,
          step: 'moderator_assignments',
          reason: 'missing_assigned_state_ids',
          error: 'Moderator is missing assigned_state_ids',
        },
      };
    }

    if (bucket === 'user-frames') {
      const userId = parseUserIdFromUserFramesPath(path);
      if (!userId) {
        return {
          ok: false,
          status: 400,
          body: {
            ...base,
            step: 'moderator_user_frames_path',
            reason: 'invalid_user_frames_path',
            error: 'Invalid path for moderator uploads (expected public/<userId>/...)',
          },
        };
      }
      const { data: prof, error: profErr } = await admin
        .from('profiles')
        .select('id, assigned_state_ids')
        .eq('id', userId)
        .maybeSingle();
      if (profErr) {
        return {
          ok: false,
          status: 500,
          body: { ...base, step: 'moderator_profile_lookup', reason: 'supabase_error', error: profErr.message },
        };
      }
      if (!prof) {
        return {
          ok: false,
          status: 404,
          body: { ...base, step: 'moderator_profile_lookup', reason: 'profile_not_found', error: 'Profile not found' },
        };
      }
      return {
        ok: true,
        resource: {
          target_kind: 'profile',
          id: userId,
          assigned_state_ids: (prof as { assigned_state_ids?: unknown }).assigned_state_ids,
        },
        payload: { bucket, path },
        resourceId: userId,
        resourceName: userId,
      };
    }

    if (bucket === 'post-images') {
      const eventId = parseEventIdFromPostImagesPath(path);
      if (!eventId) {
        return {
          ok: false,
          status: 400,
          body: {
            ...base,
            step: 'moderator_event_path',
            reason: 'invalid_event_graphics_path',
            error: 'Invalid path for moderator event uploads (expected public/events/<eventId>/...)',
          },
        };
      }
      const { data: ev, error: evErr } = await admin
        .from('events')
        .select('id, created_by, created_role, state_id, party_id, party, target_groups, status')
        .eq('id', eventId)
        .maybeSingle();
      if (evErr) {
        return {
          ok: false,
          status: 500,
          body: { ...base, step: 'moderator_event_lookup', reason: 'supabase_error', error: evErr.message },
        };
      }
      if (!ev) {
        return {
          ok: false,
          status: 404,
          body: { ...base, step: 'moderator_event_lookup', reason: 'event_not_found', error: 'Event not found' },
        };
      }
      return {
        ok: true,
        resource: { target_kind: 'event', ...(ev as Record<string, unknown>) },
        payload: { bucket, path },
        resourceId: eventId,
        resourceName: eventId,
      };
    }

    return {
      ok: false,
      status: 403,
      body: {
        ...base,
        step: 'moderator_bucket',
        reason: 'unsupported_bucket',
        error: 'Moderator may only upload to post-images (event graphics) or user-frames buckets',
      },
    };
  }

  return {
    ok: false,
    status: 403,
    body: {
      ...base,
      step: 'role_gate',
      reason: 'role_not_allowed',
      error: 'Forbidden: role cannot upload storage',
    },
  };
}

/** Authoritative storage RBAC — must pass mutation-gateway before any storage API write. */
export async function assertStorageMutationAllowed(args: {
  auth: VerifiedAdminAuth;
  admin: SupabaseClient;
  bucket: string;
  path: string;
  action: StorageMutationAction;
}): Promise<{ ok: true } | { ok: false; body: StorageAuthRejectBody; status: number }> {
  const { auth, action } = args;
  const base = { role: auth.role, user_id: auth.user.id };

  const resolved = await resolveStorageMutationContext(args);
  if (!resolved.ok) return resolved;

  const decision = canPerformMutation(
    {
      id: auth.user.id,
      role: auth.role,
      assigned_state_ids: auth.assigned_state_ids,
      assigned_group_ids: auth.assigned_group_ids,
    },
    action,
    resolved.resource,
    resolved.payload,
    {
      resourceType: 'storage',
      resourceId: resolved.resourceId,
      resourceName: resolved.resourceName,
    }
  );

  logStorageAuth('mutation_gateway', {
    ok: decision.ok,
    ...base,
    action,
    bucket: args.bucket,
    path: args.path,
    denied_reason: decision.ok ? undefined : decision.reason,
  });

  if (!decision.ok) {
    return {
      ok: false,
      status: 403,
      body: {
        ...base,
        step: 'mutation_gateway',
        reason: decision.reason ?? 'storage_mutation_denied',
        error: decision.reason ?? 'Forbidden: storage mutation denied',
      },
    };
  }

  return { ok: true };
}

/** @deprecated Use assertStorageMutationAllowed — kept for existing import sites (upload). */
export async function assertStorageUploadAllowed(args: {
  auth: VerifiedAdminAuth;
  admin: SupabaseClient;
  bucket: string;
  path: string;
}): Promise<{ ok: true } | { ok: false; body: StorageAuthRejectBody; status: number }> {
  return assertStorageMutationAllowed({ ...args, action: 'storage.upload' });
}
