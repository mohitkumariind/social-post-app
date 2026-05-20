import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  assertStorageUploadAllowed,
  logStorageAuth,
  STORAGE_UPLOAD_ROLES,
  storageAuthJson,
} from '@/lib/admin/storage-upload-auth';
import { RbacError, requireStandardRbacContext } from '@/lib/rbac/require';
import { SECURITY_LIMITS, envLimit } from '@/lib/security-limits';

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
    logStorageAuth('validateAdminSession', {
      ok: false,
      step: 'validateAdminSession',
      reason: auth.status === 401 ? 'unauthorized' : 'forbidden',
      status: auth.status,
    });
    return storageAuthJson(
      {
        error: auth.status === 401 ? 'Unauthorized' : 'Forbidden',
        step: 'validateAdminSession',
        reason: auth.status === 401 ? 'no_session' : 'not_admin_panel_role',
      },
      auth.status
    );
  }

  logStorageAuth('session', {
    ok: true,
    step: 'validateAdminSession',
    role: auth.role,
    user_id: auth.user.id,
  });

  try {
    requireStandardRbacContext(auth, [...STORAGE_UPLOAD_ROLES]);
  } catch (e) {
    const message = e instanceof RbacError ? e.message : 'Forbidden';
    const status = e instanceof RbacError ? e.status : 403;
    const reason =
      message === 'Forbidden'
        ? `role_${auth.role}_not_in_allowlist`
        : message.toLowerCase().includes('assigned_state')
          ? 'moderator_missing_states'
          : message.toLowerCase().includes('assigned_group')
            ? 'campaign_manager_missing_groups'
            : 'rbac_context_failed';
    return storageAuthJson(
      {
        error: message,
        step: 'requireStandardRbacContext',
        reason,
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return storageAuthJson(
      {
        error: 'Expected multipart form data',
        step: 'parse_form',
        reason: 'invalid_multipart',
        role: auth.role,
        user_id: auth.user.id,
      },
      400
    );
  }

  const bucket = String(form.get('bucket') ?? '');
  const pathRaw = String(form.get('path') ?? '');
  const file = form.get('file');

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

  let path: string;
  try {
    path = assertSafePath(pathRaw);
  } catch (e) {
    return storageAuthJson(
      {
        error: e instanceof Error ? e.message : 'Invalid path',
        step: 'path_safety',
        reason: 'path_validation_failed',
        role: auth.role,
        user_id: auth.user.id,
      },
      400
    );
  }

  const perm = await assertStorageUploadAllowed({ auth, admin, bucket, path });
  if (!perm.ok) {
    return storageAuthJson(perm.body, perm.status);
  }

  if (!(file instanceof Blob)) {
    return storageAuthJson(
      {
        error: 'Missing file',
        step: 'file_present',
        reason: 'missing_file_blob',
        role: auth.role,
        user_id: auth.user.id,
      },
      400
    );
  }

  const maxUploadBytes = envLimit(
    'STORAGE_UPLOAD_MAX_BYTES',
    SECURITY_LIMITS.storageUploadMaxBytes,
    1024,
    50 * 1024 * 1024
  );
  if (file.size > maxUploadBytes) {
    return storageAuthJson(
      {
        error: `File too large. Max ${maxUploadBytes} bytes`,
        step: 'file_size',
        reason: 'file_too_large',
        role: auth.role,
        user_id: auth.user.id,
      },
      400
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || 'application/octet-stream';

  logStorageAuth('supabase_storage_upload', {
    ok: true,
    role: auth.role,
    user_id: auth.user.id,
    bucket,
    path,
    bytes: buf.length,
    note: 'service_role client bypasses storage RLS',
  });

  const { error: uploadErr } = await admin.storage.from(bucket).upload(path, buf, {
    contentType,
    upsert: true,
  });

  if (uploadErr) {
    logStorageAuth('supabase_storage_upload', {
      ok: false,
      role: auth.role,
      user_id: auth.user.id,
      bucket,
      path,
      supabase_message: uploadErr.message,
    });
    return storageAuthJson(
      {
        error: uploadErr.message,
        step: 'supabase_storage_upload',
        reason: 'storage_api_error',
        role: auth.role,
        user_id: auth.user.id,
      },
      500
    );
  }

  const { data: urlData } = admin.storage.from(bucket).getPublicUrl(path);
  logStorageAuth('success', { ok: true, role: auth.role, user_id: auth.user.id, bucket, path });
  return NextResponse.json(
    { publicUrl: urlData.publicUrl, path, bucket },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
