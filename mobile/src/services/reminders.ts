/**
 * Reminders Service
 *
 * @deprecated This service is deprecated. Use commitments.ts instead.
 *
 * This file now wraps the commitments service for backwards compatibility.
 * The backend has replaced reminders with auto-extracted commitments.
 */

import { commitmentsService, Commitment } from './commitments';
import { logger } from '../utils/logger';

// Re-export types from commitments for convenience
export type { Commitment };

// Legacy types for backwards compatibility
export interface Reminder {
  id: string;
  title: string;
  body: string | null;
  remind_at: string | null;
  reminder_type: 'time' | 'location' | 'event';
  location_name: string | null;
  status: 'pending' | 'sent' | 'snoozed' | 'completed' | 'cancelled';
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: number;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
}

export interface ReminderListResponse {
  reminders: Reminder[];
  total: number;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
}

export interface SuccessResponse {
  success: boolean;
  message?: string;
}

// Transform Commitment to Reminder format
function commitmentToReminder(commitment: Commitment): Reminder {
  return {
    id: commitment.id,
    title: commitment.content,
    body: null,
    remind_at: commitment.due_date,
    reminder_type: 'time',
    location_name: null,
    status: commitment.status === 'completed' ? 'completed' :
            commitment.status === 'cancelled' ? 'cancelled' :
            commitment.status === 'overdue' ? 'sent' : 'pending',
    created_at: commitment.created_at,
  };
}

// Transform Commitment to Task format
function commitmentToTask(commitment: Commitment): Task {
  return {
    id: commitment.id,
    title: commitment.content,
    description: null,
    due_date: commitment.due_date,
    priority: commitment.type === 'deadline' ? 1 : 2,
    is_completed: commitment.status === 'completed',
    completed_at: commitment.status === 'completed' ? commitment.updated_at : null,
    created_at: commitment.created_at,
  };
}

class RemindersService {
  /**
   * @deprecated Use commitmentsService.getCommitments() instead
   */
  async createReminder(_request: {
    title: string;
    body?: string;
    remind_at?: string;
    reminder_type?: 'time' | 'location' | 'event';
    location_name?: string;
  }): Promise<never> {
    logger.warn('RemindersService: createReminder is deprecated');
    throw new Error(
      'Creating reminders is not supported. ' +
        'Commitments are automatically extracted from your memories. ' +
        'Try adding a memory like "I need to call John tomorrow".'
    );
  }

  /**
   * @deprecated Use commitmentsService.getCommitments() instead
   */
  async listReminders(
    includeCompleted = false,
    limit = 50
  ): Promise<ReminderListResponse> {
    logger.warn('RemindersService: listReminders is deprecated, use commitmentsService.getCommitments()');

    const status = includeCompleted ? undefined : 'active';
    const response = await commitmentsService.getCommitments({ status, limit });

    return {
      reminders: response.commitments.map(commitmentToReminder),
      total: response.total,
    };
  }

  /**
   * @deprecated Use commitmentsService.getCommitment() instead
   */
  async getReminder(reminderId: string): Promise<Reminder> {
    logger.warn('RemindersService: getReminder is deprecated, use commitmentsService.getCommitment()');

    const commitment = await commitmentsService.getCommitment(reminderId);
    return commitmentToReminder(commitment);
  }

  /**
   * @deprecated Updating reminders not supported
   */
  async updateReminder(
    _reminderId: string,
    _request: { title?: string; body?: string; remind_at?: string; status?: string }
  ): Promise<never> {
    logger.warn('RemindersService: updateReminder is deprecated');
    throw new Error(
      'Updating reminders is not supported. ' +
        'Use completeReminder() or delete the commitment instead.'
    );
  }

  /**
   * @deprecated Use commitmentsService.completeCommitment() instead
   */
  async completeReminder(reminderId: string): Promise<SuccessResponse> {
    logger.warn('RemindersService: completeReminder is deprecated, use commitmentsService.completeCommitment()');

    try {
      await commitmentsService.completeCommitment(reminderId);
      return { success: true, message: 'Commitment completed' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to complete',
      };
    }
  }

  /**
   * @deprecated Snoozing not supported for commitments
   */
  async snoozeReminder(_reminderId: string, _minutes = 15): Promise<never> {
    logger.warn('RemindersService: snoozeReminder is deprecated');
    throw new Error(
      'Snoozing is not supported for commitments. ' +
        'Commitments track promises and deadlines extracted from your memories.'
    );
  }

  /**
   * @deprecated Use commitmentsService.cancelCommitment() instead
   */
  async deleteReminder(reminderId: string): Promise<SuccessResponse> {
    logger.warn('RemindersService: deleteReminder is deprecated, use commitmentsService.cancelCommitment()');

    try {
      await commitmentsService.cancelCommitment(reminderId);
      return { success: true, message: 'Commitment cancelled' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to cancel',
      };
    }
  }

  /**
   * @deprecated Location-based reminders not supported
   */
  async checkLocationReminders(
    _latitude: number,
    _longitude: number
  ): Promise<ReminderListResponse> {
    logger.warn('RemindersService: checkLocationReminders is deprecated and not available');
    return { reminders: [], total: 0 };
  }

  // ==================== TASKS ====================

  /**
   * @deprecated Use commitmentsService.getCommitments({ type: 'task' }) instead
   */
  async createTask(_request: {
    title: string;
    description?: string;
    due_date?: string;
    priority?: number;
  }): Promise<never> {
    logger.warn('RemindersService: createTask is deprecated');
    throw new Error(
      'Creating tasks is not supported. ' +
        'Tasks are automatically extracted from your memories. ' +
        'Try adding a memory like "I need to finish the report by Friday".'
    );
  }

  /**
   * @deprecated Use commitmentsService.getCommitments({ type: 'task' }) instead
   */
  async listTasks(includeCompleted = false, limit = 50): Promise<TaskListResponse> {
    logger.warn('RemindersService: listTasks is deprecated, use commitmentsService.getCommitments()');

    const status = includeCompleted ? undefined : 'active';
    const response = await commitmentsService.getCommitments({ status, type: 'task', limit });

    return {
      tasks: response.commitments.map(commitmentToTask),
      total: response.total,
    };
  }

  /**
   * @deprecated Use commitmentsService.completeCommitment() instead
   */
  async completeTask(taskId: string): Promise<SuccessResponse> {
    logger.warn('RemindersService: completeTask is deprecated, use commitmentsService.completeCommitment()');
    return this.completeReminder(taskId);
  }
}

export const remindersService = new RemindersService();
