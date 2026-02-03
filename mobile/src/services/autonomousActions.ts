/**
 * Autonomous Actions Service
 *
 * @deprecated This service is deprecated.
 *
 * The backend no longer has dedicated autonomous actions endpoints.
 * Instead, use:
 * - entitiesService.getNudges() for proactive relationship suggestions
 * - commitmentsService for tracking commitments
 * - cognitiveService for learnings and beliefs
 *
 * This file maintains backwards compatibility by wrapping the new services.
 */

import { entitiesService, Nudge } from './entities';
import { commitmentsService } from './commitments';
import { logger } from '../utils/logger';

// Legacy types for backwards compatibility
export interface AutonomousAction {
  id: string;
  action_type: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'approved' | 'dismissed';
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AutonomousActionsResponse {
  actions: AutonomousAction[];
  total: number;
}

export interface ActionExecutionResult {
  success: boolean;
  message: string;
  result?: Record<string, unknown>;
}

export interface ActionDismissResult {
  success: boolean;
  message: string;
}

export interface ActionFeedbackResult {
  success: boolean;
  message: string;
}

export interface ActionStatsResponse {
  total_actions: number;
  approved_count: number;
  dismissed_count: number;
  approval_rate: number;
}

// Transform Nudge to AutonomousAction format
function nudgeToAction(nudge: Nudge): AutonomousAction {
  return {
    id: nudge.id,
    action_type: nudge.nudge_type,
    title: nudge.title,
    description: nudge.message,
    priority: nudge.priority,
    status: 'pending',
    payload: {
      entity_id: nudge.entity_id,
      entity_name: nudge.entity_name,
      suggested_action: nudge.suggested_action,
    },
    created_at: nudge.created_at,
  };
}

class AutonomousActionsService {
  /**
   * @deprecated Use entitiesService.getNudges() instead
   */
  async getPendingActions(limit: number = 5): Promise<AutonomousActionsResponse> {
    logger.warn('AutonomousActionsService: getPendingActions is deprecated, use entitiesService.getNudges()');

    try {
      const response = await entitiesService.getNudges({ limit });
      return {
        actions: response.nudges.map(nudgeToAction),
        total: response.total,
      };
    } catch (error) {
      logger.warn('AutonomousActionsService: Failed to fetch nudges', error);
      return { actions: [], total: 0 };
    }
  }

  /**
   * @deprecated Use entitiesService.generateNudges() instead
   */
  async generateActions(): Promise<{
    success: boolean;
    actions_generated: number;
    actions: AutonomousAction[];
    message: string;
  }> {
    logger.warn('AutonomousActionsService: generateActions is deprecated, use entitiesService.generateNudges()');

    try {
      const response = await entitiesService.generateNudges();
      return {
        success: true,
        actions_generated: response.total,
        actions: response.nudges.map(nudgeToAction),
        message: `Generated ${response.total} suggestions`,
      };
    } catch (error) {
      return {
        success: false,
        actions_generated: 0,
        actions: [],
        message: error instanceof Error ? error.message : 'Failed to generate',
      };
    }
  }

  /**
   * @deprecated Not available in v3 API
   */
  async getAction(_actionId: string): Promise<AutonomousAction | null> {
    logger.warn('AutonomousActionsService: getAction is deprecated and not available');
    return null;
  }

  /**
   * @deprecated Use commitmentsService.completeCommitment() for commitment actions
   */
  async approveAction(
    actionId: string,
    _modifications?: Record<string, unknown>
  ): Promise<ActionExecutionResult> {
    logger.warn('AutonomousActionsService: approveAction is deprecated');

    // Try to complete as a commitment
    try {
      await commitmentsService.completeCommitment(actionId);
      return {
        success: true,
        message: 'Action completed',
        result: { completed: true },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Action approval not available. Use the new nudges/commitments API.',
      };
    }
  }

  /**
   * @deprecated Not available in v3 API
   */
  async dismissAction(
    _actionId: string,
    _reason?: string
  ): Promise<ActionDismissResult> {
    logger.warn('AutonomousActionsService: dismissAction is deprecated and not available');
    return {
      success: false,
      message: 'Dismissing actions is not available. Nudges are regenerated periodically.',
    };
  }

  /**
   * @deprecated Use cognitiveService.provideFeedback() for outcome feedback
   */
  async submitFeedback(
    _actionId: string,
    _feedback: { rating?: number; feedback_type?: string; comment?: string }
  ): Promise<ActionFeedbackResult> {
    logger.warn('AutonomousActionsService: submitFeedback is deprecated');
    return {
      success: false,
      message: 'Use cognitiveService.provideFeedback() for outcome feedback.',
    };
  }

  /**
   * @deprecated Not available in v3 API
   */
  async getStats(): Promise<ActionStatsResponse> {
    logger.warn('AutonomousActionsService: getStats is deprecated and not available');
    return {
      total_actions: 0,
      approved_count: 0,
      dismissed_count: 0,
      approval_rate: 0,
    };
  }
}

export const autonomousActionsService = new AutonomousActionsService();
