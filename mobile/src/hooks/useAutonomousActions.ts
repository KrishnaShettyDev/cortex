/**
 * useAutonomousActions Hook
 *
 * React Query hooks for managing Iris-style autonomous actions.
 * Provides data fetching, mutations for approve/dismiss, and optimistic updates.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import { autonomousActionsService } from '../services/autonomousActions';
import { AutonomousAction } from '../types';
import { logger } from '../utils/logger';

/**
 * Hook to fetch pending autonomous actions.
 * Auto-refreshes every 2 minutes and on app focus.
 */
export const useAutonomousActions = () => {
  return useQuery({
    queryKey: queryKeys.autonomousActions.pending(),
    queryFn: () => autonomousActionsService.getPendingActions(),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
};

/**
 * Hook to force generation of new autonomous actions.
 */
export const useGenerateActions = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => autonomousActionsService.generateActions(),
    onSuccess: (data) => {
      logger.log(`Generated ${data.actions_generated} autonomous actions`);
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomousActions.pending() });
    },
    onError: (error: Error) => {
      logger.error('Failed to generate actions:', error.message);
    },
  });
};

/**
 * Hook to approve and execute an autonomous action.
 * Includes optimistic updates for instant UI feedback.
 */
export const useApproveAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      actionId,
      modifications,
    }: {
      actionId: string;
      modifications?: Record<string, unknown>;
    }) => autonomousActionsService.approveAction(actionId, modifications),

    // Optimistic update: remove the action from the list immediately
    onMutate: async ({ actionId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.autonomousActions.pending() });

      // Snapshot the previous value
      const previousActions = queryClient.getQueryData(
        queryKeys.autonomousActions.pending()
      );

      // Optimistically update to remove the action
      queryClient.setQueryData(
        queryKeys.autonomousActions.pending(),
        (old: { actions: AutonomousAction[]; count: number } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            actions: old.actions.filter((a) => a.id !== actionId),
            count: old.count - 1,
          };
        }
      );

      return { previousActions };
    },

    onSuccess: () => {
      // Invalidate related queries after successful action
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations.status() });
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.suggestions() });
    },

    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousActions) {
        queryClient.setQueryData(
          queryKeys.autonomousActions.pending(),
          context.previousActions
        );
      }
      logger.error('Failed to approve action:', error);
    },

    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomousActions.pending() });
    },
  });
};

/**
 * Hook to dismiss an autonomous action.
 * Includes optimistic updates for instant UI feedback.
 */
export const useDismissAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      actionId,
      reason,
    }: {
      actionId: string;
      reason?: string;
    }) => autonomousActionsService.dismissAction(actionId, reason),

    // Optimistic update: remove the action from the list immediately
    onMutate: async ({ actionId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.autonomousActions.pending() });

      const previousActions = queryClient.getQueryData(
        queryKeys.autonomousActions.pending()
      );

      queryClient.setQueryData(
        queryKeys.autonomousActions.pending(),
        (old: { actions: AutonomousAction[]; count: number } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            actions: old.actions.filter((a) => a.id !== actionId),
            count: old.count - 1,
          };
        }
      );

      return { previousActions };
    },

    onError: (error, variables, context) => {
      if (context?.previousActions) {
        queryClient.setQueryData(
          queryKeys.autonomousActions.pending(),
          context.previousActions
        );
      }
      logger.error('Failed to dismiss action:', error);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomousActions.pending() });
    },
  });
};

/**
 * Hook to submit feedback on an action.
 */
export const useActionFeedback = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      actionId,
      rating,
      feedbackType,
      comment,
    }: {
      actionId: string;
      rating?: number;
      feedbackType?: string;
      comment?: string;
    }) =>
      autonomousActionsService.submitFeedback(actionId, {
        rating,
        feedback_type: feedbackType,
        comment,
      }),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomousActions.stats() });
    },

    onError: (error: Error) => {
      logger.error('Failed to submit feedback:', error.message);
    },
  });
};

/**
 * Hook to get action statistics.
 */
export const useActionStats = () => {
  return useQuery({
    queryKey: queryKeys.autonomousActions.stats(),
    queryFn: () => autonomousActionsService.getStats(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
