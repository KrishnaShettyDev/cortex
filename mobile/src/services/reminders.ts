import { api } from './api';
import { logger } from '../utils/logger';

// Types matching backend models
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

export interface CreateReminderRequest {
  title: string;
  body?: string;
  remind_at?: string;
  reminder_type?: 'time' | 'location' | 'event';
  location_name?: string;
  location_latitude?: number;
  location_longitude?: number;
  location_radius_meters?: number;
}

export interface UpdateReminderRequest {
  title?: string;
  body?: string;
  remind_at?: string;
  status?: string;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  due_date?: string;
  priority?: number;
  related_person?: string;
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

class RemindersService {
  // ==================== REMINDERS ====================

  /**
   * Create a new reminder
   */
  async createReminder(request: CreateReminderRequest): Promise<Reminder> {
    logger.log('Reminders: Creating reminder', request.title);
    return api.request<Reminder>('/reminders', {
      method: 'POST',
      body: request,
    });
  }

  /**
   * List all reminders for the current user
   */
  async listReminders(includeCompleted = false, limit = 50): Promise<ReminderListResponse> {
    logger.log('Reminders: Listing reminders');
    return api.request<ReminderListResponse>(
      `/reminders?include_completed=${includeCompleted}&limit=${limit}`
    );
  }

  /**
   * Get a specific reminder by ID
   */
  async getReminder(reminderId: string): Promise<Reminder> {
    logger.log('Reminders: Getting reminder', reminderId);
    return api.request<Reminder>(`/reminders/${reminderId}`);
  }

  /**
   * Update a reminder
   */
  async updateReminder(reminderId: string, request: UpdateReminderRequest): Promise<Reminder> {
    logger.log('Reminders: Updating reminder', reminderId);
    return api.request<Reminder>(`/reminders/${reminderId}`, {
      method: 'PUT',
      body: request,
    });
  }

  /**
   * Mark a reminder as completed
   */
  async completeReminder(reminderId: string): Promise<SuccessResponse> {
    logger.log('Reminders: Completing reminder', reminderId);
    return api.request<SuccessResponse>(`/reminders/${reminderId}/complete`, {
      method: 'POST',
    });
  }

  /**
   * Snooze a reminder
   */
  async snoozeReminder(reminderId: string, minutes = 15): Promise<Reminder> {
    logger.log('Reminders: Snoozing reminder', reminderId, 'for', minutes, 'minutes');
    return api.request<Reminder>(`/reminders/${reminderId}/snooze?minutes=${minutes}`, {
      method: 'POST',
    });
  }

  /**
   * Delete a reminder
   */
  async deleteReminder(reminderId: string): Promise<SuccessResponse> {
    logger.log('Reminders: Deleting reminder', reminderId);
    return api.request<SuccessResponse>(`/reminders/${reminderId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Check location-based reminders
   */
  async checkLocationReminders(latitude: number, longitude: number): Promise<ReminderListResponse> {
    logger.log('Reminders: Checking location reminders at', latitude, longitude);
    return api.request<ReminderListResponse>(
      `/reminders/check-location?latitude=${latitude}&longitude=${longitude}`,
      { method: 'POST' }
    );
  }

  // ==================== TASKS ====================

  /**
   * Create a new task
   */
  async createTask(request: CreateTaskRequest): Promise<Task> {
    logger.log('Tasks: Creating task', request.title);
    return api.request<Task>('/reminders/tasks', {
      method: 'POST',
      body: request,
    });
  }

  /**
   * List all tasks for the current user
   */
  async listTasks(includeCompleted = false, limit = 50): Promise<TaskListResponse> {
    logger.log('Tasks: Listing tasks');
    return api.request<TaskListResponse>(
      `/reminders/tasks?include_completed=${includeCompleted}&limit=${limit}`
    );
  }

  /**
   * Mark a task as completed
   */
  async completeTask(taskId: string): Promise<SuccessResponse> {
    logger.log('Tasks: Completing task', taskId);
    return api.request<SuccessResponse>(`/reminders/tasks/${taskId}/complete`, {
      method: 'POST',
    });
  }
}

export const remindersService = new RemindersService();
