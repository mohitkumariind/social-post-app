/**
 * Unified RBAC public surface — permission-engine is the single source of truth.
 */
export {
  canAccessScope,
  canCreateGroup,
  canDeleteEvent,
  canEditEvent,
  canTargetAudience,
  canUploadPost,
  canViewEvent,
  eventVisibilityMatch,
  filterVisibleEvents,
  normalizeScope,
  getCachedNormalizedScope,
  type CanonicalScope,
  type NormalizedEventResource,
  type PermissionDecision,
  type RbacActor,
  type RbacDebugPayload,
} from '@/lib/rbac/permission-engine';

export {
  getEventVisibilityQuery,
  isEventVisibleToActor,
  publishedGlobalFeedOrClause,
  publishedStatePartyOrClause,
  type EventVisibilityUser,
} from '@/lib/rbac/event-visibility-engine';

export {
  canPerformMutation,
  type MutationAction,
  type MutationDecision,
} from '@/lib/rbac/mutation-gateway';

export { buildEventPermissionMap, type EventRowPermissions } from '@/lib/rbac/event-permission-map';

export { auditRbacMutation, mutationAuditAction } from '@/lib/rbac/permission-audit';

export {
  isAdminRole,
  isElevatedDashboardRole,
  isCampaignManagerRole,
  isEditorRole,
  isModeratorRole,
  canAccessDashboardModule,
  canUseGlobalFilters,
  getAllowedDashboardModules,
  getDashboardFilterVisibility,
  getEventFormUiCapabilities,
  type DashboardActor,
  type DashboardFilterVisibility,
  type EventFormUiCapabilities,
  type EventFormUiMode,
} from '@/lib/rbac/dashboard-permissions';

export {
  isGlobalTargeting,
  isPublishedEvent,
  normalizeEventResource,
  normalizeResourceScope,
} from '@/lib/rbac/normalize-scope';

export { logRbacDebug } from '@/lib/rbac/debug';

export { invalidateNormalizedScopeCache, normalizedScopeCacheKey } from '@/lib/rbac/scope-cache';

export { logPermissionDecision, logPermissionDecisionFromDebug } from '@/lib/rbac/permission-audit';

export {
  buildUiPermissions,
  getEventUiCapabilities,
  canTargetAudienceUi,
  type UiPermissionBundle,
} from '@/lib/rbac/ui-capabilities';

export { evaluateRbacForUser, listDebugUsers, type RbacDebugEvaluation } from '@/lib/rbac/rbac-debug-eval';

export {
  apiPathToDashboardModule,
  assertAnalyticsGeoFiltersForDashboard,
  canAccessDashboardApi,
  canAccessDashboardPath,
  isAdminPublicPath,
  getAllowedModules,
  getAnalyticsScope,
  getBroadcastScope,
  getLeaderboardScope,
  getTwitterCampaignScope,
  getVisibleSidebarItems,
  logDashboardAccessDebug,
  pathnameToDashboardModule,
  toAdminAnalyticsScopeFromDashboard,
  toDashboardActor,
  type DashboardModuleId,
  type DashboardSidebarItem,
  type DashboardTargetingScope,
  DASHBOARD_MODULE_PATHS,
} from '@/lib/rbac/dashboard-access';

export {
  PANEL_EVENT_CREATOR_ROLES,
  PUBLISHED_EVENT_STATUSES,
} from '@/lib/rbac/scope-types';
