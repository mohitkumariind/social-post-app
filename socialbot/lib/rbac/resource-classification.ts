import { logAdminAction } from '@/lib/audit/logAdminAction';
import { trackRbacEvent } from '@/lib/rbac/rbac-observability-engine';
import type { RbacRole } from '@/lib/rbac/require';

export type RbacLayer = 'query' | 'analytics' | 'access' | 'mutation';
export type RbacResourceCategory = 'scoped' | 'owner_only' | 'global' | 'unsupported';

export type RbacResourcePolicy = {
  category: RbacResourceCategory;
  scope_model: string;
  ownership_behavior: string;
  allow_ownership_fallback: boolean;
  analytics_behavior: string;
  supported_layers: RbacLayer[];
};

export const RBAC_RESOURCE_REGISTRY: Record<string, RbacResourcePolicy> = {
  events: {
    category: 'scoped',
    scope_model: 'moderator: state_ids subset, campaign_manager: target_groups subset',
    ownership_behavior: 'no ownership fallback for missing scope',
    allow_ownership_fallback: false,
    analytics_behavior: 'same as read scoping (subset, fail-closed)',
    supported_layers: ['query', 'analytics', 'access', 'mutation'],
  },
  profiles: {
    category: 'scoped',
    scope_model: 'moderator: assigned_state_ids subset, campaign_manager: assigned groups via memberships/group_id',
    ownership_behavior: 'no ownership fallback for missing scope',
    allow_ownership_fallback: false,
    analytics_behavior: 'same as read scoping (subset, fail-closed)',
    supported_layers: ['query', 'analytics', 'access', 'mutation'],
  },
  posts: {
    category: 'scoped',
    scope_model: 'moderator: state_id subset, campaign_manager: group_id subset',
    ownership_behavior: 'no ownership fallback for missing scope',
    allow_ownership_fallback: false,
    analytics_behavior: 'same as read scoping (subset, fail-closed)',
    supported_layers: ['query', 'analytics', 'access', 'mutation'],
  },
  admin_logs: {
    category: 'scoped',
    scope_model: 'moderator: scope_state_ids subset, campaign_manager: scope_group_ids subset',
    ownership_behavior: 'no ownership fallback for missing scope',
    allow_ownership_fallback: false,
    analytics_behavior: 'not applicable',
    supported_layers: ['query', 'access'],
  },
  notifications: {
    category: 'scoped',
    scope_model: 'moderator: assigned_state_ids subset, campaign_manager: group_ids subset',
    ownership_behavior: 'no ownership fallback for missing scope',
    allow_ownership_fallback: false,
    analytics_behavior: 'not applicable',
    supported_layers: ['access', 'mutation'],
  },
  scheduled_notifications: {
    category: 'scoped',
    scope_model: 'same target scoping model as notifications',
    ownership_behavior: 'no ownership fallback for missing scope',
    allow_ownership_fallback: false,
    analytics_behavior: 'not applicable',
    supported_layers: ['access', 'mutation'],
  },
  notification_templates: {
    category: 'owner_only',
    scope_model: 'owner-only by created_by (admin unrestricted)',
    ownership_behavior: 'ownership is required for non-admin',
    allow_ownership_fallback: true,
    analytics_behavior: 'not applicable',
    supported_layers: ['query', 'access', 'mutation'],
  },
  twitter_campaigns: {
    category: 'owner_only',
    scope_model: 'owner-only by created_by (admin unrestricted)',
    ownership_behavior: 'ownership is required for non-admin',
    allow_ownership_fallback: true,
    analytics_behavior: 'not applicable',
    supported_layers: ['query', 'access', 'mutation'],
  },
  groups: {
    category: 'scoped',
    scope_model: 'moderator owner-created groups, campaign_manager assigned_group_ids subset',
    ownership_behavior: 'legacy owner checks in moderator flows; explicit group scope preferred',
    allow_ownership_fallback: true,
    analytics_behavior: 'not applicable',
    supported_layers: ['query', 'access', 'mutation'],
  },
  parties: {
    category: 'global',
    scope_model: 'admin-only reference data',
    ownership_behavior: 'elevated admin only',
    allow_ownership_fallback: false,
    analytics_behavior: 'not applicable',
    supported_layers: ['mutation'],
  },
  dashboard_banners: {
    category: 'global',
    scope_model: 'banner manager roles only',
    ownership_behavior: 'elevated admin / super_admin',
    allow_ownership_fallback: false,
    analytics_behavior: 'not applicable',
    supported_layers: ['mutation'],
  },
};

export const RBAC_SCOPED_RESOURCES = new Set<string>(
  Object.entries(RBAC_RESOURCE_REGISTRY)
    .filter(([, policy]) => policy.category === 'scoped')
    .map(([name]) => name)
);

export const RBAC_OWNER_ONLY_RESOURCES = new Set<string>(
  Object.entries(RBAC_RESOURCE_REGISTRY)
    .filter(([, policy]) => policy.category === 'owner_only')
    .map(([name]) => name)
);

export const RBAC_GLOBAL_RESOURCES = new Set<string>(
  Object.entries(RBAC_RESOURCE_REGISTRY)
    .filter(([, policy]) => policy.category === 'global')
    .map(([name]) => name)
);

export const RBAC_UNSUPPORTED_RESOURCES = new Set<string>(
  Object.entries(RBAC_RESOURCE_REGISTRY)
    .filter(([, policy]) => policy.category === 'unsupported')
    .map(([name]) => name)
);

export function normalizeResourceType(resourceType: string | null | undefined): string {
  return String(resourceType ?? '').trim();
}

export function getRbacResourcePolicy(resourceType: string | null | undefined): RbacResourcePolicy | null {
  const key = normalizeResourceType(resourceType);
  if (!key) return null;
  return RBAC_RESOURCE_REGISTRY[key] ?? null;
}

export function canUseOwnershipFallback(resourceType: string | null | undefined): boolean {
  const policy = getRbacResourcePolicy(resourceType);
  return Boolean(policy?.allow_ownership_fallback);
}

export type RbacRegistrationDecision =
  | { ok: true; resourceType: string; policy: RbacResourcePolicy }
  | { ok: false; resourceType: string; reason: string };

export function validateRegisteredResourceForLayer(resourceType: string | null | undefined, layer: RbacLayer): RbacRegistrationDecision {
  const normalized = normalizeResourceType(resourceType);
  if (!normalized) return { ok: false, resourceType: normalized, reason: 'Missing RBAC resourceType registration' };
  const policy = getRbacResourcePolicy(normalized);
  if (!policy) return { ok: false, resourceType: normalized, reason: `Unknown RBAC resourceType: ${normalized}` };
  if (policy.category === 'unsupported') return { ok: false, resourceType: normalized, reason: `Unsupported RBAC resourceType: ${normalized}` };
  if (!policy.supported_layers.includes(layer)) {
    return { ok: false, resourceType: normalized, reason: `RBAC resourceType ${normalized} is not supported in ${layer} layer` };
  }
  return { ok: true, resourceType: normalized, policy };
}

export function auditUnsupportedResourceUsage(args: {
  user: { id: string; role: RbacRole; assigned_state_ids?: number[]; assigned_group_ids?: string[] };
  resourceType: string | null | undefined;
  layer: RbacLayer;
  reason: string;
  action?: string;
  resourceId?: string | null;
  resourceName?: string | null;
  details?: Record<string, unknown>;
}) {
  const normalized = normalizeResourceType(args.resourceType);
  void trackRbacEvent({
    user_id: args.user.id,
    role: args.user.role,
    event_type: args.layer === 'mutation' ? 'mutation' : 'read',
    action: args.action ?? `rbac.${args.layer}.resource_validation`,
    resource_type: normalized || '__unknown__',
    resource_id: args.resourceId ?? null,
    result: 'denied',
    severity: 'warning',
    scope_state_ids: Array.isArray(args.user.assigned_state_ids) ? args.user.assigned_state_ids : [],
    scope_group_ids: Array.isArray(args.user.assigned_group_ids) ? args.user.assigned_group_ids : [],
    metadata: { denied: true, layer: args.layer, reason: args.reason, ...(args.details ?? {}) },
  });
  void logAdminAction({
    actor_user_id: args.user.id,
    actor_role: args.user.role,
    action_type: `${args.action ?? `rbac.${args.layer}.resource_validation`}.denied`,
    resource_type: normalized || '__unknown__',
    resource_id: args.resourceId ?? null,
    resource_name: args.resourceName ?? null,
    severity: 'warning',
    undoable: false,
    metadata: { denied: true, layer: args.layer, reason: args.reason, ...(args.details ?? {}) },
    scope_state_ids: Array.isArray(args.user.assigned_state_ids) ? args.user.assigned_state_ids : [],
    scope_group_ids: Array.isArray(args.user.assigned_group_ids) ? args.user.assigned_group_ids : [],
  });
}
