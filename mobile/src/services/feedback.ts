import { api } from './api';
import { logger } from '../utils/logger';

export interface FeedbackRequest {
  feedback_type: 'positive' | 'negative' | 'correction';
  feedback_context: 'response' | 'suggestion' | 'memory_retrieval' | 'action';
  conversation_id?: string;
  message_id?: string;
  user_query?: string;
  ai_response?: string;
  correction_text?: string;
  memories_used?: string[];
}

export interface FeedbackResponse {
  id: string;
  feedback_type: string;
  message: string;
}

export interface UserPreferences {
  preferences: Record<string, any>;
  user_model_prompt: string;
}

export interface LearningStats {
  memories: {
    total: number;
    average_strength: number;
    average_emotional_weight: number;
  };
  feedback: {
    positive: number;
    negative: number;
    corrections: number;
  };
  preferences_learned: number;
  insights_generated: number;
}

class FeedbackService {
  /**
   * Submit feedback on an AI response
   */
  async submitFeedback(request: FeedbackRequest): Promise<FeedbackResponse> {
    logger.log('FeedbackService: Submitting feedback', request.feedback_type);
    return api.request<FeedbackResponse>('/feedback', {
      method: 'POST',
      body: request,
    });
  }

  /**
   * Submit positive feedback (thumbs up)
   */
  async thumbsUp(
    conversationId: string,
    messageId: string,
    userQuery?: string,
    aiResponse?: string,
    memoriesUsed?: string[]
  ): Promise<FeedbackResponse> {
    return this.submitFeedback({
      feedback_type: 'positive',
      feedback_context: 'response',
      conversation_id: conversationId,
      message_id: messageId,
      user_query: userQuery,
      ai_response: aiResponse,
      memories_used: memoriesUsed,
    });
  }

  /**
   * Submit negative feedback (thumbs down)
   */
  async thumbsDown(
    conversationId: string,
    messageId: string,
    userQuery?: string,
    aiResponse?: string,
    memoriesUsed?: string[]
  ): Promise<FeedbackResponse> {
    return this.submitFeedback({
      feedback_type: 'negative',
      feedback_context: 'response',
      conversation_id: conversationId,
      message_id: messageId,
      user_query: userQuery,
      ai_response: aiResponse,
      memories_used: memoriesUsed,
    });
  }

  /**
   * Submit a correction
   */
  async submitCorrection(
    conversationId: string,
    messageId: string,
    correctionText: string,
    userQuery?: string,
    aiResponse?: string
  ): Promise<FeedbackResponse> {
    return this.submitFeedback({
      feedback_type: 'correction',
      feedback_context: 'response',
      conversation_id: conversationId,
      message_id: messageId,
      user_query: userQuery,
      ai_response: aiResponse,
      correction_text: correctionText,
    });
  }

  /**
   * Get learned user preferences
   */
  async getPreferences(): Promise<UserPreferences> {
    logger.log('FeedbackService: Getting user preferences');
    return api.request<UserPreferences>('/feedback/preferences');
  }

  /**
   * Get learning statistics
   */
  async getStats(): Promise<LearningStats> {
    logger.log('FeedbackService: Getting learning stats');
    return api.request<LearningStats>('/feedback/stats');
  }

  /**
   * Log a memory access (for tracking patterns)
   */
  async logMemoryAccess(
    memoryId: string,
    accessType: 'search' | 'chat_retrieval' | 'connection' | 'direct' | 'suggestion' = 'direct',
    queryText?: string
  ): Promise<void> {
    logger.log('FeedbackService: Logging memory access', memoryId);
    await api.request(`/feedback/memory/${memoryId}/accessed?access_type=${accessType}${queryText ? `&query_text=${encodeURIComponent(queryText)}` : ''}`, {
      method: 'POST',
    });
  }
}

export const feedbackService = new FeedbackService();
