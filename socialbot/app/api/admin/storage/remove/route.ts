import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  assertStorageMutationAllowed,
  logStorageAuth,
  STORAGE_UPLOAD_ROLES,
  storageAuthJson,
} from '@/lib/admin/storage-upload-auth';
import { RbacError, requireStandardRbacContext } from '@/lib/rbac/require';
import { SECURITY_LIMITS } from '@/lib/security-limits';

const ALLOWED_BUCKETS = new Set(['post-images', 'user-frames']);

function assertSafePath(path: string): string {
  const p = path.trim();
  if (!p || p.includes('..') || p.startsWith('/')) {
    throw new Error('Invalid path');
  }
  if (!p.startsWith('public/')) {
    throw new Error('Path must start with public/');
  }
  return p;
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);

  if (!auth.ok) {
    return storageAuthJson(
      {
        error: auth.status === 401 ? 'Unauthorized' : 'Forbidden',
        step: 'validateAdminSession',
        reason: auth.status === 401 ? 'no_session' : 'not_admin_panel_role',
      },
      auth.status
    );
  }

  try {
    requireStandardRbacContext(auth, [...STORAGE_UPLOAD_ROLES]);
  } catch (e) {
    const message = e instanceof RbacError ? e.message : 'Forbidden';
    const status = e instanceof RbacError ? e.status : 403;
    return storageAuthJson(
      {
        error: message,
        step: 'requireStandardRbacContext',
        reason: 'rbac_context_failed',
        role: auth.role,
        user_id: auth.user.id,
      },
      status
    );
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return storageAuthJson(
      {
        error: 'SUPABASE_SERVICE_ROLE_KEY not configured',
        step: 'service_role_client',
        reason: 'missing_service_role_key',
        role: auth.role,
        user_id: auth.user.id,
      },
      503
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return storageAuthJson(
      {
        error: 'Invalid JSON',
        step: 'parse_body',
        reason: 'invalid_json',
        role: auth.role,
        user_id: auth.user.id,
      },
      400
    );
  }

  const b = body as { bucket?: string; paths?: unknown };
  const bucket = String(b.bucket ?? '');
  const pathsRaw = Array.isArray(b.paths) ? b.paths : [];

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return storageAuthJson(
      {
        error: 'Invalid bucket',
        step: 'bucket_allowlist',
        reason: 'bucket_not_allowed',
        role: auth.role,
        user_id: auth.user.id,
      },
      400
    );
  }

  const paths: string[] = [];
  for (const raw of pathsRaw) {
    try {
      paths.push(assertSafePath(String(raw)));
    } catch (e) {
      return storageAuthJson(
        {
          error: e instanceof Error ? e.message : 'Invalid path in list',
          step: 'path_safety',
          reason: 'path_validation_failed',
          role: auth.role,
          user_id: auth.user.id,
        },
        400
      );
    }
  }

  if (paths.length === 0) {
    return NextResponse.json({ ok: true, removed: 0 });
  }
  if (paths.length > SECURITY_LIMITS.storageRemovePaths) {
    return storageAuthJson(
      {
        error: `Too many paths. Max ${SECURITY_LIMITS.storageRemovePaths}`,
        step: 'paths_limit',
        reason: 'too_many_paths',
        role: auth.role,
        user_id: auth.user.id,
      },
      400
    );
  }

  for (const path of paths) {
    const perm = await assertStorageMutationAllowed({ auth, admin, bucket, path, action: 'storage.delete' });
    if (!perm.ok) {
      return storageAuthJson(perm.body, perm.status);
    }
  }

  const { error } = await admin.storage.from(bucket).remove(paths);
  if (error) {
    return storageAuthJson(
      {
        error: error.message,
        step: 'supabase_storage_remove',
        reason: 'storage_api_error',
        role: auth.role,
        user_id: auth.user.id,
      },
      500
    );
  }

  logStorageAuth('remove_success', { ok: true, role: auth.role, user_id: auth.user.id, bucket, count: paths.length });
  return NextResponse.json({ ok: true, removed: paths.length });
}
