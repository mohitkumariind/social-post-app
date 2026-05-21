import type { DashboardFilterVisibility } from '@/lib/rbac/dashboard-access';
import type { DashboardModuleId } from '@/lib/rbac/dashboard-access';

const DEV = process.env.NODE_ENV !== 'production';

export function logDashboardUiRbac(
  source: string,
  detail: {
    role?: string;
    allowed_modules?: DashboardModuleId[];
    hidden_modules?: DashboardModuleId[];
    denied_actions?: string[];
    filter_visibility?: Partial<DashboardFilterVisibility>;
  }
): void {
  if (!DEV) return;
  console.log('[dashboard-ui-rbac]', source, detail);
}
