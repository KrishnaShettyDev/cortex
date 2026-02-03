/**
 * useNudges Hook
 *
 * React Query hook for fetching real proactive nudges from /v3/nudges.
 * These are actual relationship health nudges, commitment reminders, etc.
 */

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import { api } from '../services/api';
import { logger } from '../utils/logger';

export interface Nudge {
  id: string;
  nudge_type: 'relationship_maintenance' | 'follow_up' | 'commitment_due' | 'dormant_relationship' | 'deadline_approaching' | 'overdue_commitment';
  priority: 'urgent' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  entity_id: string | null;
  entity_name: string | null;
  commitment_id: string | null;
  memory_id: string | null;
  suggested_action: string | null;
  confidence_score: number;
  scheduled_for: string;
  expires_at: string;
  status: 'pending' | 'sent' | 'dismissed' | 'acted_on';
}

export interface NudgesResponse {
  nudges: Nudge[];
  metadata: {
    total_generated: number;
    high_priority_count: number;
    processing_time_ms: number;
  };
}

/**
 * Fetch real nudges from /v3/nudges
 */
async function fetchNudges(): Promise<NudgesResponse> {
  try {
    const response = await api.request<NudgesResponse>('/v3/nudges');
    return response;
  } catch (error: any) {
    logger.error('Failed to fetch nudges:', error);
    // Return empty state on error
    return {
      nudges: [],
      metadata: {
        total_generated: 0,
        high_priority_count: 0,
        processing_time_ms: 0,
      },
    };
  }
}

/**
 * Hook to fetch proactive nudges
 */
export const useNudges = () => {
  return useQuery({
    queryKey: queryKeys.nudges?.list() || ['nudges'],
    queryFn: fetchNudges,
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });
};

/**
 * Get icon for nudge type
 */
export function getNudgeIcon(nudgeType: Nudge['nudge_type']): string {
  switch (nudgeType) {
    case 'relationship_maintenance':
      return 'heart-outline';
    case 'follow_up':
      return 'arrow-redo-outline';
    case 'commitment_due':
    case 'deadline_approaching':
      return 'time-outline';
    case 'overdue_commitment':
      return 'alert-circle-outline';
    case 'dormant_relationship':
      return 'sad-outline';
    default:
      return 'notifications-outline';
  }
}

/**
 * Get color for nudge priority
 */
export function getNudgePriorityColor(priority: Nudge['priority'], colors: any): string {
  switch (priority) {
    case 'urgent':
      return colors.error;
    case 'high':
      return colors.warning;
    case 'medium':
      return colors.accent;
    case 'low':
      return colors.textSecondary;
    default:
      return colors.textSecondary;
  }
}
