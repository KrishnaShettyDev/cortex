/**
 * MCP Server Implementation
 *
 * Exposes Cortex capabilities via Model Context Protocol.
 * This allows AI clients like Claude Desktop to:
 * - Search and recall user memories
 * - Execute actions (email, calendar)
 * - Access user context and briefings
 */

import type { D1Database } from '@cloudflare/workers-types';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  Tool,
  Resource,
  Prompt,
  ServerCapabilities,
  ServerInfo,
  InitializeResponse,
  ListToolsResponse,
  CallToolRequest,
  CallToolResponse,
  ListResourcesResponse,
  ReadResourceRequest,
  ReadResourceResponse,
  ListPromptsResponse,
  GetPromptRequest,
  GetPromptResponse,
  TextContent,
  MCP_VERSION,
} from './types';
import { createActionExecutor } from '../actions';

export interface MCPServerConfig {
  db: D1Database;
  composioApiKey: string;
  userId: string;
  vectorize?: Vectorize;
  ai?: any;
}

/**
 * Cortex MCP Server
 *
 * Implements the Model Context Protocol to expose Cortex
 * functionality to external AI clients.
 */
export class CortexMCPServer {
  private config: MCPServerConfig;
  private initialized = false;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  /**
   * Handle incoming JSON-RPC request
   */
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      const result = await this.dispatch(request.method, request.params || {});
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error: any) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: error.message || 'Internal error',
        },
      };
    }
  }

  /**
   * Dispatch request to appropriate handler
   */
  private async dispatch(method: string, params: Record<string, any>): Promise<any> {
    switch (method) {
      case 'initialize':
        return this.handleInitialize(params);
      case 'initialized':
        return {}; // Acknowledgment
      case 'tools/list':
        return this.handleListTools();
      case 'tools/call':
        return this.handleCallTool(params);
      case 'resources/list':
        return this.handleListResources();
      case 'resources/read':
        return this.handleReadResource(params);
      case 'prompts/list':
        return this.handleListPrompts();
      case 'prompts/get':
        return this.handleGetPrompt(params);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(params: any): Promise<InitializeResponse> {
    this.initialized = true;

    return {
      protocolVersion: '2024-11-05',
      capabilities: this.getCapabilities(),
      serverInfo: this.getServerInfo(),
    };
  }

  /**
   * Get server capabilities
   */
  private getCapabilities(): ServerCapabilities {
    return {
      tools: {},
      resources: {
        subscribe: false,
        listChanged: false,
      },
      prompts: {},
      logging: {},
    };
  }

  /**
   * Get server info
   */
  private getServerInfo(): ServerInfo {
    return {
      name: 'cortex-memory',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
    };
  }

  /**
   * List available tools
   */
  private async handleListTools(): Promise<ListToolsResponse> {
    const tools: Tool[] = [
      {
        name: 'recall_memories',
        description: 'Search and recall relevant memories from the user\'s personal knowledge base. Use this to find past conversations, notes, and experiences.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query to find relevant memories',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of memories to return (default: 10)',
              default: 10,
            },
            timeRange: {
              type: 'string',
              description: 'Time range filter: "today", "week", "month", "year", or "all"',
              enum: ['today', 'week', 'month', 'year', 'all'],
              default: 'all',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'add_memory',
        description: 'Add a new memory to the user\'s knowledge base. Use this to store important information the user shares.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The content to remember',
            },
            source: {
              type: 'string',
              description: 'Source of the memory (e.g., "chat", "note", "meeting")',
              default: 'mcp',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'get_briefing',
        description: 'Get the user\'s daily briefing including upcoming events, pending commitments, and insights.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_commitments',
        description: 'Get the user\'s pending commitments and things they said they would do.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'Filter by status: "pending", "overdue", or "all"',
              enum: ['pending', 'overdue', 'all'],
              default: 'all',
            },
          },
        },
      },
      {
        name: 'get_entities',
        description: 'Get information about people, organizations, and topics in the user\'s knowledge graph.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Entity type filter: "person", "organization", "topic", or "all"',
              enum: ['person', 'organization', 'topic', 'all'],
              default: 'all',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of entities to return',
              default: 20,
            },
          },
        },
      },
      {
        name: 'send_email',
        description: 'Send an email on behalf of the user. Requires Gmail integration.',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address',
            },
            subject: {
              type: 'string',
              description: 'Email subject',
            },
            body: {
              type: 'string',
              description: 'Email body content',
            },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      {
        name: 'create_calendar_event',
        description: 'Create a calendar event for the user. Requires Google Calendar integration.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Event title',
            },
            start_time: {
              type: 'string',
              description: 'Start time in ISO format (e.g., "2024-01-15T10:00:00Z")',
            },
            end_time: {
              type: 'string',
              description: 'End time in ISO format',
            },
            description: {
              type: 'string',
              description: 'Event description',
            },
            location: {
              type: 'string',
              description: 'Event location',
            },
          },
          required: ['title', 'start_time', 'end_time'],
        },
      },
      {
        name: 'search_emails',
        description: 'Search through the user\'s emails. Requires Gmail integration.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Gmail search query',
            },
            max_results: {
              type: 'number',
              description: 'Maximum results to return',
              default: 10,
            },
          },
          required: ['query'],
        },
      },
    ];

    return { tools };
  }

  /**
   * Call a tool
   */
  private async handleCallTool(params: CallToolRequest): Promise<CallToolResponse> {
    const { name, arguments: args = {} } = params;

    try {
      let result: any;

      switch (name) {
        case 'recall_memories':
          result = await this.recallMemories(args);
          break;
        case 'add_memory':
          result = await this.addMemory(args);
          break;
        case 'get_briefing':
          result = await this.getBriefing();
          break;
        case 'get_commitments':
          result = await this.getCommitments(args);
          break;
        case 'get_entities':
          result = await this.getEntities(args);
          break;
        case 'send_email':
          result = await this.sendEmail(args);
          break;
        case 'create_calendar_event':
          result = await this.createCalendarEvent(args);
          break;
        case 'search_emails':
          result = await this.searchEmails(args);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * List available resources
   */
  private async handleListResources(): Promise<ListResourcesResponse> {
    const resources: Resource[] = [
      {
        uri: 'cortex://profile',
        name: 'User Profile',
        description: 'User\'s profile information and preferences',
        mimeType: 'application/json',
      },
      {
        uri: 'cortex://learnings',
        name: 'Learnings',
        description: 'Insights and patterns learned about the user',
        mimeType: 'application/json',
      },
      {
        uri: 'cortex://beliefs',
        name: 'Beliefs',
        description: 'User\'s beliefs and preferences with confidence scores',
        mimeType: 'application/json',
      },
      {
        uri: 'cortex://entities',
        name: 'Entity Graph',
        description: 'People, organizations, and topics the user interacts with',
        mimeType: 'application/json',
      },
    ];

    return { resources };
  }

  /**
   * Read a resource
   */
  private async handleReadResource(params: ReadResourceRequest): Promise<ReadResourceResponse> {
    const { uri } = params;

    let content: any;

    switch (uri) {
      case 'cortex://profile':
        content = await this.getProfile();
        break;
      case 'cortex://learnings':
        content = await this.getLearnings();
        break;
      case 'cortex://beliefs':
        content = await this.getBeliefs();
        break;
      case 'cortex://entities':
        content = await this.getEntities({ type: 'all', limit: 50 });
        break;
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(content, null, 2),
        },
      ],
    };
  }

  /**
   * List available prompts
   */
  private async handleListPrompts(): Promise<ListPromptsResponse> {
    const prompts: Prompt[] = [
      {
        name: 'briefing',
        description: 'Get a comprehensive daily briefing with context',
      },
      {
        name: 'meeting_prep',
        description: 'Prepare context for an upcoming meeting',
        arguments: [
          {
            name: 'attendees',
            description: 'Comma-separated list of attendee names or emails',
            required: true,
          },
        ],
      },
      {
        name: 'relationship_summary',
        description: 'Get a summary of relationship with a person',
        arguments: [
          {
            name: 'person',
            description: 'Name of the person',
            required: true,
          },
        ],
      },
    ];

    return { prompts };
  }

  /**
   * Get a prompt
   */
  private async handleGetPrompt(params: GetPromptRequest): Promise<GetPromptResponse> {
    const { name, arguments: args = {} } = params;

    switch (name) {
      case 'briefing':
        return this.getBriefingPrompt();
      case 'meeting_prep':
        return this.getMeetingPrepPrompt(args.attendees || '');
      case 'relationship_summary':
        return this.getRelationshipPrompt(args.person || '');
      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  }

  // Tool implementations

  private async recallMemories(args: { query: string; limit?: number; timeRange?: string }) {
    const { query, limit = 10, timeRange = 'all' } = args;

    // Build time filter
    let timeFilter = '';
    const now = new Date();
    switch (timeRange) {
      case 'today':
        timeFilter = `AND created_at >= date('now')`;
        break;
      case 'week':
        timeFilter = `AND created_at >= date('now', '-7 days')`;
        break;
      case 'month':
        timeFilter = `AND created_at >= date('now', '-30 days')`;
        break;
      case 'year':
        timeFilter = `AND created_at >= date('now', '-365 days')`;
        break;
    }

    // Simple keyword search (vector search would need embedding)
    const memories = await this.config.db.prepare(`
      SELECT id, content, source, created_at, importance_score
      FROM memories
      WHERE user_id = ? AND is_forgotten = 0
      AND content LIKE ?
      ${timeFilter}
      ORDER BY importance_score DESC, created_at DESC
      LIMIT ?
    `).bind(this.config.userId, `%${query}%`, limit).all();

    return {
      query,
      count: memories.results?.length || 0,
      memories: memories.results?.map((m: any) => ({
        id: m.id,
        content: m.content,
        source: m.source,
        created_at: m.created_at,
        importance: m.importance_score,
      })),
    };
  }

  private async addMemory(args: { content: string; source?: string }) {
    const { content, source = 'mcp' } = args;
    const id = crypto.randomUUID();

    await this.config.db.prepare(`
      INSERT INTO memories (id, user_id, container_tag, content, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      this.config.userId,
      'default',
      content,
      source,
      new Date().toISOString(),
      new Date().toISOString()
    ).run();

    return { success: true, id, message: 'Memory added successfully' };
  }

  private async getBriefing() {
    const now = new Date();
    const todayStart = now.toISOString().split('T')[0];

    const [commitments, entities, memories] = await Promise.all([
      this.config.db.prepare(`
        SELECT * FROM commitments
        WHERE user_id = ? AND status IN ('pending', 'overdue')
        ORDER BY due_date ASC LIMIT 10
      `).bind(this.config.userId).all(),

      this.config.db.prepare(`
        SELECT name, entity_type, importance_score
        FROM entities
        WHERE user_id = ?
        ORDER BY importance_score DESC LIMIT 10
      `).bind(this.config.userId).all(),

      this.config.db.prepare(`
        SELECT COUNT(*) as count FROM memories
        WHERE user_id = ? AND is_forgotten = 0
      `).bind(this.config.userId).first<{ count: number }>(),
    ]);

    return {
      date: todayStart,
      commitments: {
        count: commitments.results?.length || 0,
        items: commitments.results,
      },
      topEntities: entities.results,
      totalMemories: memories?.count || 0,
    };
  }

  private async getCommitments(args: { status?: string }) {
    const { status = 'all' } = args;

    let statusFilter = '';
    if (status === 'pending') {
      statusFilter = `AND status = 'pending'`;
    } else if (status === 'overdue') {
      statusFilter = `AND status = 'overdue'`;
    }

    const commitments = await this.config.db.prepare(`
      SELECT * FROM commitments
      WHERE user_id = ? ${statusFilter}
      ORDER BY due_date ASC
    `).bind(this.config.userId).all();

    return {
      count: commitments.results?.length || 0,
      commitments: commitments.results,
    };
  }

  private async getEntities(args: { type?: string; limit?: number }) {
    const { type = 'all', limit = 20 } = args;

    let typeFilter = '';
    if (type !== 'all') {
      typeFilter = `AND entity_type = '${type}'`;
    }

    const entities = await this.config.db.prepare(`
      SELECT * FROM entities
      WHERE user_id = ? ${typeFilter}
      ORDER BY importance_score DESC
      LIMIT ?
    `).bind(this.config.userId, limit).all();

    return {
      count: entities.results?.length || 0,
      entities: entities.results,
    };
  }

  private async sendEmail(args: { to: string; subject: string; body: string }) {
    const executor = createActionExecutor({
      composioApiKey: this.config.composioApiKey,
      db: this.config.db,
      userId: this.config.userId,
    });

    return await executor.executeAction({
      action: 'send_email',
      parameters: args,
      confirmed: true, // MCP tools are pre-authorized
    });
  }

  private async createCalendarEvent(args: {
    title: string;
    start_time: string;
    end_time: string;
    description?: string;
    location?: string;
  }) {
    const executor = createActionExecutor({
      composioApiKey: this.config.composioApiKey,
      db: this.config.db,
      userId: this.config.userId,
    });

    return await executor.executeAction({
      action: 'create_calendar_event',
      parameters: args,
      confirmed: true,
    });
  }

  private async searchEmails(args: { query: string; max_results?: number }) {
    const executor = createActionExecutor({
      composioApiKey: this.config.composioApiKey,
      db: this.config.db,
      userId: this.config.userId,
    });

    return await executor.executeAction({
      action: 'search_emails',
      parameters: args,
    });
  }

  // Resource implementations

  private async getProfile() {
    const user = await this.config.db.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(this.config.userId).first();

    const prefs = await this.config.db.prepare(
      'SELECT * FROM notification_preferences WHERE user_id = ?'
    ).bind(this.config.userId).first();

    return { user, preferences: prefs };
  }

  private async getLearnings() {
    const learnings = await this.config.db.prepare(`
      SELECT * FROM learnings
      WHERE user_id = ? AND status = 'active'
      ORDER BY confidence DESC
      LIMIT 50
    `).bind(this.config.userId).all();

    return { learnings: learnings.results };
  }

  private async getBeliefs() {
    const beliefs = await this.config.db.prepare(`
      SELECT * FROM beliefs
      WHERE user_id = ? AND status = 'active'
      ORDER BY current_confidence DESC
      LIMIT 50
    `).bind(this.config.userId).all();

    return { beliefs: beliefs.results };
  }

  // Prompt implementations

  private async getBriefingPrompt(): Promise<GetPromptResponse> {
    const briefing = await this.getBriefing();

    return {
      description: 'Daily briefing with context',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Here is my daily briefing for ${briefing.date}:

**Commitments (${briefing.commitments.count}):**
${briefing.commitments.items?.map((c: any) => `- ${c.title} (due: ${c.due_date})`).join('\n') || 'None'}

**Key People/Topics:**
${briefing.topEntities?.map((e: any) => `- ${e.name} (${e.entity_type})`).join('\n') || 'None'}

**Total Memories:** ${briefing.totalMemories}

Please help me plan my day effectively based on this context.`,
          },
        },
      ],
    };
  }

  private async getMeetingPrepPrompt(attendees: string): Promise<GetPromptResponse> {
    const attendeeList = attendees.split(',').map((a) => a.trim());

    // Get context about each attendee
    const context: string[] = [];
    for (const attendee of attendeeList) {
      const memories = await this.config.db.prepare(`
        SELECT content FROM memories
        WHERE user_id = ? AND content LIKE ?
        AND is_forgotten = 0
        ORDER BY created_at DESC LIMIT 3
      `).bind(this.config.userId, `%${attendee}%`).all();

      if (memories.results?.length) {
        context.push(`**${attendee}:**`);
        for (const m of memories.results as any[]) {
          context.push(`- ${m.content.slice(0, 200)}...`);
        }
      }
    }

    return {
      description: 'Meeting preparation context',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I have an upcoming meeting with: ${attendees}

Here's what I know about them:

${context.join('\n') || 'No previous context found.'}

Please help me prepare for this meeting with:
1. Key talking points
2. Questions to ask
3. Any commitments I should follow up on`,
          },
        },
      ],
    };
  }

  private async getRelationshipPrompt(person: string): Promise<GetPromptResponse> {
    const memories = await this.config.db.prepare(`
      SELECT content, created_at FROM memories
      WHERE user_id = ? AND content LIKE ?
      AND is_forgotten = 0
      ORDER BY created_at DESC LIMIT 10
    `).bind(this.config.userId, `%${person}%`).all();

    const entity = await this.config.db.prepare(`
      SELECT * FROM entities
      WHERE user_id = ? AND name LIKE ?
      LIMIT 1
    `).bind(this.config.userId, `%${person}%`).first();

    const commitments = await this.config.db.prepare(`
      SELECT * FROM commitments
      WHERE user_id = ? AND title LIKE ?
      ORDER BY created_at DESC LIMIT 5
    `).bind(this.config.userId, `%${person}%`).all();

    return {
      description: `Relationship summary for ${person}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please summarize my relationship with ${person}:

**Entity Info:**
${entity ? JSON.stringify(entity, null, 2) : 'Not found in knowledge graph'}

**Recent Interactions (${memories.results?.length || 0}):**
${memories.results?.map((m: any) => `- [${m.created_at}] ${m.content.slice(0, 150)}...`).join('\n') || 'None'}

**Commitments:**
${commitments.results?.map((c: any) => `- ${c.title} (${c.status})`).join('\n') || 'None'}

Please provide:
1. Relationship summary
2. Key interactions
3. Any pending follow-ups
4. Suggestions for strengthening this relationship`,
          },
        },
      ],
    };
  }
}

/**
 * Factory function
 */
export function createMCPServer(config: MCPServerConfig): CortexMCPServer {
  return new CortexMCPServer(config);
}
