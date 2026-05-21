import type { AdminPanelRole } from '@/lib/profile-roles';

/** Canonical scope dimensions (arrays only; empty = no extra restriction inside assigned scope). */
export type CanonicalScope = {
  state_ids: number[];
  party_ids: number[];
  party_slugs: string[];
  loksabha_ids: number[];
  assembly_ids: number[];
  group_ids: string[];
};

export type RbacActor = {
  id: string;
  role: AdminPanelRole;
  assigned_state_ids: number[];
  assigned_group_ids: string[];
  /** Profile slug allowlist; empty = all parties within state scope. */
  assigned_party_ids: string[];
  assigned_loksabha_ids?: number[];
  assigned_assembly_ids?: number[];
  /** Resolved CM group ids when membership expansion is applied. */
  effective_group_ids?: string[];
};

export type NormalizedEventResource = CanonicalScope & {
  created_by?: string | null;
  created_role?: string | null;
  status?: string | null;
  published_at?: string | null;
  dashboard_category?: unknown;
};

export const PANEL_EVENT_CREATOR_ROLES = ['moderator', 'campaign_manager', 'editor'] as const;

export const PUBLISHED_EVENT_STATUSES = [
  'published',
  'scheduled_publish',
  'processing_publish',
] as const;

export type PermissionDecision = {
  allowed: boolean;
  denied_reason?: string;
  debug: RbacDebugPayload;
};

export type RbacDebugPayload = {
  role: string;
  normalized_scope: CanonicalScope;
  ownership_match: boolean;
  visibility_match: boolean;
  mutation_permission: boolean;
  denied_reason?: string;
  action?: string;
};
