/**
 * Commitments Service
 *
 * Replaces the old reminders.ts service with the v3 commitments API.
 * Commitments are auto-extracted from memories - promises, deadlines, goals, tasks.
 */

import { api } from './api';

// ============== Commitment Types ==============

export interface Commitment {
  id: string;
  user_id: string;
  content: string;
  type: 'promise' | 'deadline' | 'goal' | 'task';
  status: 'active' | 'completed' | 'cancelled' | 'overdue';
  due_date: string | null;
  entity_id: string | null;
  entity_name: string | null;
  source_memory_id: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

// ============== Response Types ==============

export interface CommitmentsListResponse {
  commitments: Commitment[];
  total: number;
}

export interface CommitmentResponse {
  commitment: Commitment;
}

// ============== Service ==============

class CommitmentsService {
  /**
   * List all commitments for the current user
   */
  async getCommitments(params?: {
    status?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<CommitmentsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append('status', params.status);
    if (params?.type) searchParams.append('type', params.type);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());

    const query = searchParams.toString();
    return api.request<CommitmentsListResponse>(`/v3/commitments${query ? `?${query}` : ''}`);
  }

  /**
   * Get a single commitment by ID
   */
  async getCommitment(id: string): Promise<Commitment> {
    const response = await api.request<CommitmentResponse>(`/v3/commitments/${id}`);
    return response.commitment;
  }

  /**
   * Get overdue commitments
   */
  async getOverdueCommitments(): Promise<CommitmentsListResponse> {
    return api.request<CommitmentsListResponse>('/v3/commitments/overdue');
  }

  /**
   * Get upcoming commitments (due in the next 7 days)
   */
  async getUpcomingCommitments(): Promise<CommitmentsListResponse> {
    return api.request<CommitmentsListResponse>('/v3/commitments/upcoming');
  }

  /**
   * Mark a commitment as completed
   */
  async completeCommitment(id: string): Promise<Commitment> {
    const response = await api.request<CommitmentResponse>(`/v3/commitments/${id}/complete`, {
      method: 'POST',
    });
    return response.commitment;
  }

  /**
   * Cancel a commitment
   */
  async cancelCommitment(id: string): Promise<Commitment> {
    const response = await api.request<CommitmentResponse>(`/v3/commitments/${id}/cancel`, {
      method: 'POST',
    });
    return response.commitment;
  }

  // ============== Legacy Compatibility ==============
  // These methods map the old reminders.ts interface to the new commitments API
  // Note: Commitments are auto-extracted from memories, so create/update don't exist

  /**
   * @deprecated Use getCommitments() instead
   * Maps old reminder list to commitments
   */
  async listReminders(
    includeCompleted = false,
    limit = 50
  ): Promise<{ reminders: Commitment[]; total: number }> {
    const status = includeCompleted ? undefined : 'active';
    const response = await this.getCommitments({ status, limit });
    return {
      reminders: response.commitments,
      total: response.total,
    };
  }

  /**
   * @deprecated Use getCommitment(id) instead
   */
  async getReminder(id: string): Promise<Commitment> {
    return this.getCommitment(id);
  }

  /**
   * @deprecated Use completeCommitment(id) instead
   */
  async completeReminder(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.completeCommitment(id);
      return { success: true, message: 'Commitment completed' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to complete',
      };
    }
  }

  /**
   * @deprecated Creating reminders not supported - commitments are auto-extracted
   */
  async createReminder(_request: {
    title: string;
    body?: string;
    remind_at?: string;
  }): Promise<never> {
    throw new Error(
      'Creating reminders is not supported. ' +
        'Commitments are automatically extracted from your memories. ' +
        'Try adding a memory like "I need to call John tomorrow".'
    );
  }

  /**
   * @deprecated Updating reminders not supported
   */
  async updateReminder(_id: string, _request: unknown): Promise<never> {
    throw new Error(
      'Updating reminders is not supported. ' +
        'Use completeCommitment() or cancelCommitment() instead.'
    );
  }

  /**
   * @deprecated Snoozing not supported for commitments
   */
  async snoozeReminder(_id: string, _minutes = 15): Promise<never> {
    throw new Error(
      'Snoozing is not supported for commitments. ' +
        'Commitments track promises and deadlines extracted from your memories.'
    );
  }

  /**
   * @deprecated Use cancelCommitment() instead
   */
  async deleteReminder(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.cancelCommitment(id);
      return { success: true, message: 'Commitment cancelled' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to cancel',
      };
    }
  }

  /**
   * @deprecated Tasks are now part of commitments with type='task'
   */
  async listTasks(includeCompleted = false, limit = 50): Promise<{ tasks: Commitment[]; total: number }> {
    const status = includeCompleted ? undefined : 'active';
    const response = await this.getCommitments({ status, type: 'task', limit });
    return {
      tasks: response.commitments,
      total: response.total,
    };
  }

  /**
   * @deprecated Use completeCommitment(id) instead
   */
  async completeTask(id: string): Promise<{ success: boolean; message: string }> {
    return this.completeReminder(id);
  }

  /**
   * @deprecated Creating tasks not supported - commitments are auto-extracted
   */
  async createTask(_request: { title: string; description?: string }): Promise<never> {
    throw new Error(
      'Creating tasks is not supported. ' +
        'Tasks are automatically extracted from your memories. ' +
        'Try adding a memory like "I need to finish the report by Friday".'
    );
  }

  /**
   * @deprecated Location-based reminders not supported
   */
  async checkLocationReminders(
    _latitude: number,
    _longitude: number
  ): Promise<{ reminders: Commitment[]; total: number }> {
    console.warn('CommitmentsService: Location-based reminders not supported');
    return { reminders: [], total: 0 };
  }
}

export const commitmentsService = new CommitmentsService();

// Also export as remindersService for backwards compatibility
export const remindersService = commitmentsService;
