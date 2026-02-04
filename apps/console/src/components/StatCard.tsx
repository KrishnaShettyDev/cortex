import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  loading?: boolean;
}

export function StatCard({ title, value, icon: Icon, loading }: StatCardProps) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-3">
        <Icon className="w-5 h-5 text-zinc-500" />
        <span className="text-sm text-zinc-400">{title}</span>
      </div>
      {loading ? (
        <div className="h-8 w-16 bg-zinc-800 rounded animate-pulse" />
      ) : (
        <p className="text-2xl font-semibold text-zinc-100">{value}</p>
      )}
    </div>
  );
}
