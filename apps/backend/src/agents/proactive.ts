/**
 * Proactive Agent
 *
 * Generates context-aware push notifications by enriching
 * incoming events (emails, calendar) with memory context.
 */

import type { Bindings } from '../types';
import type { ProactiveResult, AgentContext } from './types';
import { getAgentConfig, type TemplateContext } from './config';
import { startExecution } from './logger';
import { searchMemories } from '../memory';

export interface ProactiveEvent {
  type: 'email' | 'calendar' | 'trigger';
  data: {
    from?: string;
    subject?: string;
    snippet?: string;
    eventName?: string;
    startTime?: string;
    attendees?: string[];
    triggerName?: string;
    metadata?: Record<string, any>;
  };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * Proactive Agent - generates memory-enriched notifications
 */
export class ProactiveAgent {
  private env: Bindings;
  private context: AgentContext;

  constructor(env: Bindings, context: AgentContext) {
    this.env = env;
    this.context = context;
  }

  /**
   * Generate a notification for an incoming event
   */
  async generateNotification(event: ProactiveEvent): Promise<ProactiveResult> {
    const templateContext: TemplateContext = {
      userName: this.context.userName || 'there',
      userEmail: this.context.userEmail || '',
      currentDate: new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      currentTime: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }),
    };

    const config = await getAgentConfig(
      this.env.DB,
      'proactive',
      this.context.userId,
      templateContext
    );

    if (!config) {
      throw new Error('Failed to load proactive agent config');
    }

    const tracker = startExecution(this.env.DB, {
      userId: this.context.userId,
      requestId: this.context.requestId,
      agentType: 'proactive',
      model: config.model,
      goal: `Generate notification for ${event.type}`,
    });

    try {
      // Step 1: Search for relevant memories about the sender/topic
      const memoryQuery = this.buildMemoryQuery(event);
      const memories = await searchMemories(
        this.env.DB,
        this.env.VECTORIZE,
        this.context.userId,
        memoryQuery,
        this.env.AI,
        { limit: 3 }
      );

      // Step 2: Build prompt with event data and memory context
      const memoryContext =
        memories.length > 0
          ? memories
              .map((m) => {
                const date = new Date(m.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                });
                return `(${date}) ${m.content}`;
              })
              .join('\n')
          : 'No relevant memories found.';

      const eventDescription = this.formatEvent(event);

      const messages = [
        { role: 'system' as const, content: config.systemPrompt },
        {
          role: 'user' as const,
          content: `EVENT DATA:\n${eventDescription}\n\nMEMORY CONTEXT:\n${memoryContext}\n\nGenerate the notification JSON.`,
        },
      ];

      // Step 3: Call LLM
      const response = await this.callOpenAI(messages, config.model, config.temperature, config.maxTokens);

      await tracker.end({
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        toolCalls: 0,
        status: 'completed',
      });

      // Step 4: Parse response
      const content = response.choices[0].message.content || '{}';
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const notification = JSON.parse(jsonMatch[0]);
          return {
            title: notification.title || 'New notification',
            body: notification.body || '',
            priority: notification.priority || 'normal',
            suggestedActions: notification.suggested_actions || ['View', 'Dismiss'],
            sourceEvent: event,
          };
        }
      } catch {
        // Fall through to default
      }

      // Default notification if parsing fails
      return this.getDefaultNotification(event);
    } catch (error) {
      await tracker.end({
        inputTokens: 0,
        outputTokens: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Return default notification on error
      return this.getDefaultNotification(event);
    }
  }

  /**
   * Build a memory search query based on the event
   */
  private buildMemoryQuery(event: ProactiveEvent): string {
    switch (event.type) {
      case 'email':
        // Search for memories about the sender
        const from = event.data.from || '';
        const subject = event.data.subject || '';
        // Extract name or email from "Name <email@domain.com>" format
        const nameMatch = from.match(/^([^<]+)/);
        const emailMatch = from.match(/<([^>]+)>/);
        const name = nameMatch ? nameMatch[1].trim() : '';
        const email = emailMatch ? emailMatch[1] : from;
        return `${name} ${email} ${subject}`.trim();

      case 'calendar':
        // Search for memories about the event or attendees
        const eventName = event.data.eventName || '';
        const attendees = event.data.attendees?.join(' ') || '';
        return `${eventName} ${attendees}`.trim();

      case 'trigger':
        return event.data.triggerName || '';

      default:
        return '';
    }
  }

  /**
   * Format event data for the LLM prompt
   */
  private formatEvent(event: ProactiveEvent): string {
    switch (event.type) {
      case 'email':
        return [
          `Type: Email`,
          `From: ${event.data.from || 'Unknown'}`,
          `Subject: ${event.data.subject || 'No subject'}`,
          `Preview: ${event.data.snippet || ''}`,
        ].join('\n');

      case 'calendar':
        return [
          `Type: Calendar Event`,
          `Event: ${event.data.eventName || 'Untitled'}`,
          `Start: ${event.data.startTime || 'Unknown'}`,
          `Attendees: ${event.data.attendees?.join(', ') || 'None'}`,
        ].join('\n');

      case 'trigger':
        return [
          `Type: Trigger`,
          `Trigger: ${event.data.triggerName || 'Unknown'}`,
          `Data: ${JSON.stringify(event.data.metadata || {})}`,
        ].join('\n');

      default:
        return JSON.stringify(event);
    }
  }

  /**
   * Get default notification when LLM fails
   */
  private getDefaultNotification(event: ProactiveEvent): ProactiveResult {
    switch (event.type) {
      case 'email':
        return {
          title: event.data.from ? `New email from ${event.data.from.split('<')[0].trim()}` : 'New email',
          body: event.data.subject || 'No subject',
          priority: 'normal',
          suggestedActions: ['Read', 'Archive'],
          sourceEvent: event,
        };

      case 'calendar':
        return {
          title: event.data.eventName || 'Upcoming event',
          body: event.data.startTime
            ? `Starting at ${new Date(event.data.startTime).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              })}`
            : '',
          priority: 'normal',
          suggestedActions: ['View', 'Snooze'],
          sourceEvent: event,
        };

      case 'trigger':
        return {
          title: event.data.triggerName || 'Reminder',
          body: '',
          priority: 'normal',
          suggestedActions: ['View', 'Dismiss'],
          sourceEvent: event,
        };

      default:
        return {
          title: 'Notification',
          body: '',
          priority: 'normal',
          suggestedActions: ['View'],
          sourceEvent: event,
        };
    }
  }

  /**
   * Classify email urgency based on content and sender
   */
  async classifyUrgency(
    event: ProactiveEvent
  ): Promise<'critical' | 'high' | 'normal' | 'low'> {
    if (event.type !== 'email') {
      return 'normal';
    }

    const subject = (event.data.subject || '').toLowerCase();
    const snippet = (event.data.snippet || '').toLowerCase();
    const from = (event.data.from || '').toLowerCase();

    // Critical: OTPs, security alerts
    const criticalPatterns = [
      /otp|verification code|security code|2fa|two-factor/,
      /security alert|suspicious activity|account compromised/,
      /urgent.*password|password.*reset/,
    ];

    for (const pattern of criticalPatterns) {
      if (pattern.test(subject) || pattern.test(snippet)) {
        return 'critical';
      }
    }

    // Low: Marketing, newsletters
    const lowPatterns = [
      /unsubscribe|newsletter|marketing|promotional/,
      /no-?reply@|noreply@/,
      /@mail\.(linkedin|facebook|twitter|instagram)\.com/,
      /sale|discount|offer|deal/,
    ];

    for (const pattern of lowPatterns) {
      if (pattern.test(subject) || pattern.test(snippet) || pattern.test(from)) {
        return 'low';
      }
    }

    // Check if sender is in VIP list (check memories)
    const memoryQuery = this.buildMemoryQuery(event);
    const memories = await searchMemories(
      this.env.DB,
      this.env.VECTORIZE,
      this.context.userId,
      memoryQuery,
      this.env.AI,
      { limit: 1 }
    );

    // If we have memories about this person, they're probably important
    if (memories.length > 0) {
      const memoryContent = memories[0].content.toLowerCase();
      // Check for VIP indicators in memory
      if (/vip|important|boss|ceo|manager|investor|partner|client/.test(memoryContent)) {
        return 'high';
      }
    }

    return 'normal';
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    model: string,
    temperature: number,
    maxTokens: number
  ): Promise<OpenAIResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    return response.json() as Promise<OpenAIResponse>;
  }
}

/**
 * Create a proactive agent instance
 */
export function createProactiveAgent(env: Bindings, context: AgentContext): ProactiveAgent {
  return new ProactiveAgent(env, context);
}
