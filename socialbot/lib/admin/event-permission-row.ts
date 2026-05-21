/** Maps admin event list/detail shapes to permission-engine row input. */
export function eventRowForPermissions(row: {
  id?: string | number;
  created_by?: string | null;
  created_role?: string | null;
  status?: string | null;
  party?: string[] | string | null;
  party_id?: number[] | string | null;
  state?: string[] | string | null;
  state_id?: number[] | string | null;
  target_groups?: string[] | string | null;
  dashboard_category?: string | null;
}): Record<string, unknown> {
  return {
    id: row.id,
    created_by: row.created_by ?? null,
    created_role: row.created_role ?? null,
    status: row.status ?? null,
    party: row.party,
    party_id: row.party_id ?? null,
    state: row.state,
    state_id: row.state_id ?? row.state,
    target_groups: row.target_groups,
    dashboard_category: row.dashboard_category ?? null,
  };
}
