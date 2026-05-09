# RLS Security Posture

This document records intended Row-Level Security posture for operational safety.

## Principles

- Client/session-facing tables should default deny unless explicitly needed by app flows.
- Admin APIs use service-role for controlled operations, but route-level RBAC remains mandatory.
- Service-role usage must never be treated as an authorization mechanism.

## Tables with explicit security relevance

- `profiles`
- `events`
- `posts`
- `groups`
- `group_memberships`
- `scheduled_notifications`
- `notification_broadcasts`
- `notifications_history`
- `admin_logs`
- `rbac_observability_events`
- analytics rollup tables

## Expected posture

- **Operational/admin tables** (`admin_logs`, `scheduled_notifications`, analytics rollups):
  - RLS enabled
  - no broad anonymous/public access
  - server-side service-role access only

- **End-user tables**:
  - least-privilege policies scoped to authenticated user identity and app needs

## Audit checklist for policy changes

1. Does this policy grant broader visibility than RBAC route behavior?
2. Could anonymous users access data via direct API/table calls?
3. Are write policies constrained by ownership/scope?
4. Is there an equivalent server-side authorization check before service-role writes?

## Change safety guidance

- Document policy intent in migration comments.
- Prefer additive policy migrations with explicit rollback notes.
- Validate with application-level RBAC tests after policy changes.
