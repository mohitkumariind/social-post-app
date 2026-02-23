import { Users, FileText, Building2 } from 'lucide-react';

const stats = [
  { label: 'Total Users', value: '12,847', icon: Users },
  { label: 'Posts', value: '3,241', icon: FileText },
  { label: 'Parties', value: '24', icon: Building2 },
];

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Overview</h2>
        <p className="mt-1 text-sm text-zinc-400">
          SocialBot admin dashboard – manage content and users
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-400">{label}</p>
              <div className="rounded-lg bg-zinc-800 p-2">
                <Icon className="h-5 w-5 text-zinc-300" strokeWidth={2} />
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
