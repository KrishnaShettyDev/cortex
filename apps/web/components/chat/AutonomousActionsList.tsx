/**
 * AutonomousActionsList Component
 * Container for autonomous action cards
 */

'use client';

import { AutonomousActionCard } from './AutonomousActionCard';
import type { AutonomousAction } from '@/types/autonomousActions';

interface AutonomousActionsListProps {
  actions: AutonomousAction[];
  onApprove: (actionId: string, modifications?: Record<string, unknown>) => void;
  onDismiss: (actionId: string, reason?: string) => void;
  isLoading?: boolean;
  loadingActionId?: string;
}

export function AutonomousActionsList({
  actions,
  onApprove,
  onDismiss,
  isLoading = false,
  loadingActionId,
}: AutonomousActionsListProps) {
  if (actions.length === 0) return null;

  return (
    <div className="mb-xl px-lg">
      <h3 className="text-sm font-semibold text-text-primary mb-md">
        Actions I Can Handle
      </h3>
      <div className="space-y-md">
        {actions.map((action) => (
          <AutonomousActionCard
            key={action.id}
            action={action}
            onApprove={onApprove}
            onDismiss={onDismiss}
            isLoading={isLoading && loadingActionId === action.id}
          />
        ))}
      </div>
    </div>
  );
}
