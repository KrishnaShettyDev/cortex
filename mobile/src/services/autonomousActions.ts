/**
 * Autonomous Actions Service
 *
 * Service for managing Iris-style autonomous action suggestions.
 * Handles fetching, approving, dismissing, and providing feedback on actions.
 */

import { api } from './api';
import {
  AutonomousAction,
  AutonomousActionsResponse,
  ActionExecutionResult,
  ActionDismissResult,
  ActionFeedbackResult,
  ActionStatsResponse,
} from '../types';

class AutonomousActionsService {
  /**
   * Get pending autonomous actions for the current user.
   * Returns actions ordered by priority.
   */
  async getPendingActions(limit: number = 5): Promise<AutonomousActionsResponse> {
    return api.request<AutonomousActionsResponse>(`/autonomous-actions?limit=${limit}`, {
      method: 'GET',
    });
  }

  /**
   * Force generation of new autonomous actions.
   * Analyzes current context and generates suggestions.
   */
  async generateActions(): Promise<{
    success: boolean;
    actions_generated: number;
    actions: AutonomousAction[];
    message: string;
  }> {
    return api.request('/autonomous-actions/generate', {
      method: 'POST',
    });
  }

  /**
   * Get a specific action by ID.
   */
  async getAction(actionId: string): Promise<AutonomousAction> {
    return api.request<AutonomousAction>(`/autonomous-actions/${actionId}`, {
      method: 'GET',
    });
  }

  /**
   * Approve and execute an autonomous action.
   * Optionally accepts modifications to the action payload.
   */
  async approveAction(
    actionId: string,
    modifications?: Record<string, unknown>
  ): Promise<ActionExecutionResult> {
    return api.request<ActionExecutionResult>(`/autonomous-actions/${actionId}/approve`, {
      method: 'POST',
      body: modifications ? { modifications } : undefined,
    });
  }

  /**
   * Dismiss an autonomous action.
   * Optionally accepts a reason for the dismissal.
   */
  async dismissAction(
    actionId: string,
    reason?: string
  ): Promise<ActionDismissResult> {
    return api.request<ActionDismissResult>(`/autonomous-actions/${actionId}/dismiss`, {
      method: 'POST',
      body: reason ? { reason } : undefined,
    });
  }

  /**
   * Submit feedback on an action.
   * Can include rating (1-5), feedback type, and comments.
   */
  async submitFeedback(
    actionId: string,
    feedback: {
      rating?: number;
      feedback_type?: string;
      comment?: string;
    }
  ): Promise<ActionFeedbackResult> {
    return api.request<ActionFeedbackResult>(`/autonomous-actions/${actionId}/feedback`, {
      method: 'POST',
      body: feedback,
    });
  }

  /**
   * Get statistics on autonomous actions for the current user.
   */
  async getStats(): Promise<ActionStatsResponse> {
    return api.request<ActionStatsResponse>('/autonomous-actions/stats/summary', {
      method: 'GET',
    });
  }
}

export const autonomousActionsService = new AutonomousActionsService();
