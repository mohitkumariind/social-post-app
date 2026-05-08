import type { NextRequest } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAdminAction, type AdminLogSeverity } from '@/lib/audit/logAdminAction';

export type WithAuditConfig<TBefore = unknown, TAfter = unknown> = {
  action_type: string;
  resource_type: string;
  severity?: AdminLogSeverity;
  undoable?: boolean;
  /**
   * Fetch the "previous" snapshot for UPDATE/DELETE actions.
   * Called only after auth is validated and before the handler runs.
   */
  getPreviousData?: (args: { req: NextRequest; auth: Awaited<ReturnType<typeof validateAdminSession>> & { ok: true }; admin: any }) => Promise<TBefore>;
  /**
   * Build the audit log fields from handler output.
   * If omitted, `new_data` defaults to the parsed JSON body (when available).
   */
  build?: (args: {
    req: NextRequest;
    auth: Awaited<ReturnType<typeof validateAdminSession>> & { ok: true };
    previous_data: TBefore | null;
    response_json: any | null;
    response_status: number;
  }) => {
    resource_id?: string | null;
    resource_name?: string | null;
    new_data?: TAfter | unknown;
    metadata?: Record<string, unknown>;
    affected_users_count?: number | null;
    scope_state_ids?: number[];
    scope_group_ids?: string[];
    scope_user_ids?: string[];
  };
  /**
   * If true, log even for non-2xx responses (default false).
   */
  logOnError?: boolean;
};

export function withAudit<TBefore = unknown, TAfter = unknown>(
  handler: (args: {
    req: NextRequest;
    auth: Awaited<ReturnType<typeof validateAdminSession>> & { ok: true };
    admin: any;
    supabase: any;
    previous_data: TBefore | null;
  }) => Promise<Response>,
  config: WithAuditConfig<TBefore, TAfter>
) {
  return async (req: NextRequest) => {
    const supabase = await createSupabaseServerClient();
    const auth = await validateAdminSession(supabase);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }), {
        status: auth.status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }

    const admin = createServiceRoleClient();
    if (!admin) {
      return new Response(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }), {
        status: 503,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }

    let previous_data: TBefore | null = null;
    try {
      previous_data = config.getPreviousData ? await config.getPreviousData({ req, auth, admin }) : null;
    } catch {
      previous_data = null;
    }

    const res = await handler({ req, auth, admin, supabase, previous_data });

    // Parse JSON if possible (fail-open).
    let response_json: any | null = null;
    try {
      const clone = res.clone();
      const ct = clone.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        response_json = await clone.json();
      }
    } catch {
      response_json = null;
    }

    const shouldLog = config.logOnError ? true : res.status >= 200 && res.status < 300;
    if (shouldLog) {
      try {
        const built = config.build
          ? config.build({ req, auth, previous_data, response_json, response_status: res.status })
          : {};
        void logAdminAction({
          actor_user_id: auth.user.id,
          actor_role: auth.role,
          action_type: config.action_type,
          resource_type: config.resource_type,
          resource_id: built.resource_id ?? null,
          resource_name: built.resource_name ?? null,
          previous_data,
          new_data: built.new_data ?? response_json,
          metadata: built.metadata ?? {},
          affected_users_count: built.affected_users_count ?? null,
          severity: config.severity ?? 'info',
          undoable: config.undoable ?? false,
          scope_state_ids: built.scope_state_ids ?? [],
          scope_group_ids: built.scope_group_ids ?? [],
          scope_user_ids: built.scope_user_ids ?? [],
          actor_ip: req.headers.get('x-forwarded-for'),
          actor_device: req.headers.get('user-agent'),
        });
      } catch {
        // fail-open
      }
    }

    return res;
  };
}

