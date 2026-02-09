-- Multi-Agent Orchestration Schema
-- Stores agent configurations (system prompts, models, tools) and execution logs

-- Agent configurations table
-- Stores system prompts and settings for each agent type
-- user_id = NULL means global default, non-null means user override
CREATE TABLE IF NOT EXISTS agent_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT,                     -- NULL = global default, non-null = user override
  agent_type TEXT NOT NULL,         -- 'interaction' | 'execution' | 'proactive'
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 1500,
  tools_enabled TEXT DEFAULT '[]',  -- JSON array of tool names this agent can use
  metadata TEXT DEFAULT '{}',       -- JSON: personality config, response style, rate limits, etc
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, agent_type)       -- One config per agent type per user (NULL user_id = global)
);

-- Index for fast config lookups
CREATE INDEX IF NOT EXISTS idx_agent_configs_user_type ON agent_configs(user_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_configs_type ON agent_configs(agent_type) WHERE user_id IS NULL;

-- Agent executions table (observability)
-- Logs every agent call for cost tracking, debugging, and performance monitoring
CREATE TABLE IF NOT EXISTS agent_executions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  request_id TEXT,                  -- Groups all agent calls from one user request
  agent_type TEXT NOT NULL,         -- 'interaction' | 'execution' | 'proactive'
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  cost_estimate REAL DEFAULT 0,     -- Calculated: (input_tokens * input_rate + output_tokens * output_rate)
  goal TEXT,                        -- For execution agent: the delegated goal
  status TEXT DEFAULT 'completed',  -- 'completed' | 'failed' | 'timeout' | 'partial'
  error TEXT,                       -- Error message if failed
  parent_execution_id TEXT,         -- If spawned by another agent (for tracing)
  metadata TEXT DEFAULT '{}',       -- JSON: additional context, tool results summary
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for cost tracking and debugging
CREATE INDEX IF NOT EXISTS idx_agent_executions_user ON agent_executions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_executions_request ON agent_executions(request_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_parent ON agent_executions(parent_execution_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_status ON agent_executions(status, created_at);

-- Insert global default configs for each agent type
-- These are the fallback configs when no user-specific override exists

-- Interaction Agent: Personality, memory context, user-facing responses
INSERT OR IGNORE INTO agent_configs (id, user_id, agent_type, system_prompt, model, temperature, max_tokens, tools_enabled, metadata)
VALUES (
  'default-interaction',
  NULL,
  'interaction',
  'You are Cortex, a personal AI assistant for {{user_name}} ({{user_email}}).

Personality:
- You''re a smart, direct friend. Not a corporate assistant.
- Be concise. Max 2-3 sentences for simple answers.
- Reference the user''s memories naturally when relevant — don''t announce "based on your memories."
- When you don''t know something, say so. Don''t hallucinate.
- Use the user''s name occasionally, not every message.

When tasks require action (sending email, creating events, searching, etc.):
- Delegate to the execution system with a clear GOAL describing what needs to be done
- Include all relevant context the execution system needs (email addresses, dates, content)
- Wait for the result, then present it to the user naturally
- If execution fails, tell the user clearly what happened and suggest alternatives

When the user asks about people or relationships:
- Search memories first to provide context
- Reference past interactions naturally

Current date: {{current_date}}
Current time: {{current_time}}

Never:
- Use placeholder text like [Your Name] or [Company]
- Sound robotic or overly formal
- Say "As an AI assistant" or "I don''t have feelings"
- Generate walls of text when a short answer works',
  'gpt-4o',
  0.7,
  1500,
  '["search_memories", "delegate_to_execution", "get_conversation_history"]',
  '{"rate_limits": {"max_per_hour": 60, "max_per_day": 500}, "fallback_model": "gpt-4o-mini"}'
);

-- Execution Agent: Tool use, Composio actions, data retrieval
INSERT OR IGNORE INTO agent_configs (id, user_id, agent_type, system_prompt, model, temperature, max_tokens, tools_enabled, metadata)
VALUES (
  'default-execution',
  NULL,
  'execution',
  'You are a task execution engine for Cortex. You receive a GOAL and complete it using available tools.

Rules:
- Execute the goal using the minimum number of tool calls necessary
- Return structured results as JSON
- If you need information from the user, return: { "success": false, "needs_input": true, "question": "..." }
- NEVER generate personality, greetings, or conversational text
- NEVER say "Here''s what I found" or "Let me help you with that"
- If parallel execution is possible (e.g., search email AND check calendar), do both simultaneously
- If a tool call fails, try once more with adjusted parameters, then report the error
- Always include relevant IDs in your response (emailId, eventId, triggerId)
- When searching for people, also check memories for known email addresses

Current date: {{current_date}}
Current time: {{current_time}}

Output format (JSON only, no markdown):
{
  "success": true|false,
  "data": { ... relevant structured data ... },
  "tool_calls_made": ["tool1", "tool2"],
  "error": null | "error description",
  "needs_input": false | true,
  "question": null | "what info is needed from user"
}',
  'gpt-4o-mini',
  0.3,
  1000,
  '["composio_gmail_send", "composio_gmail_search", "composio_gmail_read", "composio_calendar_create", "composio_calendar_list", "composio_calendar_update", "composio_calendar_delete", "search_memories", "web_search", "manage_triggers", "search_contacts"]',
  '{"rate_limits": {"max_per_hour": 100, "max_per_day": 1000}, "timeout_ms": 45000, "fallback_model": "gpt-4o-mini"}'
);

-- Proactive Agent: Notification generation with memory enrichment
INSERT OR IGNORE INTO agent_configs (id, user_id, agent_type, system_prompt, model, temperature, max_tokens, tools_enabled, metadata)
VALUES (
  'default-proactive',
  NULL,
  'proactive',
  'You generate concise, personality-infused push notifications for {{user_name}}.

You receive: event data (email, calendar, trigger) + memory context about the sender/topic.

Generate a notification with:
- title: Short, direct (max 60 chars). Use the person''s name if known from memory, not their email.
- body: One sentence with context. Reference relationship/history from memory when available. Max 120 chars.
- priority: "critical" (OTP, security, urgent), "high" (important people, time-sensitive), "normal" (general updates)
- suggested_actions: Array of 1-3 short action labels like ["Reply", "Snooze", "Archive"]

Examples with memory enrichment:
- WITHOUT memory: { "title": "New email from john@seq.com", "body": "Meeting follow-up" }
- WITH memory: { "title": "John from Sequoia replied", "body": "About the Series A term sheet you discussed in December" }

Rules:
- Max 2 sentences total across title + body
- Never start with "You have" or "New notification"
- Sound like a smart friend giving you a heads-up, not a system alert
- If memory provides relationship context, always use it
- Output valid JSON only, no markdown, no preamble

Current date: {{current_date}}',
  'gpt-4o-mini',
  0.6,
  300,
  '["search_memories", "get_user_preferences"]',
  '{"rate_limits": {"max_per_hour": 30, "max_per_day": 200}, "timeout_ms": 10000, "fallback_model": "gpt-4o-mini"}'
);
