/**
 * Multi-Agent Orchestration System
 *
 * Exports:
 * - AgentRouter: Main orchestration layer for chat
 * - ProactiveAgent: Notification generation with memory enrichment
 * - Config utilities: Load and manage agent configurations
 * - Logger utilities: Track agent executions for observability
 */

// Router (Interaction + Execution agents)
export { AgentRouter, createRouter, type RouterOptions, type ChatInput } from './router';

// Proactive Agent
export { ProactiveAgent, createProactiveAgent, type ProactiveEvent } from './proactive';

// Config management
export {
  getAgentConfig,
  getAllAgentConfigs,
  upsertAgentConfig,
  deleteUserConfig,
  clearConfigCache,
  applyTemplateVariables,
  getModelPricing,
  calculateCost,
  type AgentType,
  type AgentConfig,
  type TemplateContext,
} from './config';

// Execution logging
export {
  startExecution,
  getUserExecutions,
  getUserStats,
  getRequestTrace,
  type ExecutionTracker,
  type ExecutionLog,
  type ExecutionStatus,
  type ExecutionStartParams,
  type ExecutionEndParams,
} from './logger';

// Types
export type {
  AgentContext,
  AgentMessage,
  AgentResponse,
  InteractionResult,
  ExecutionResult,
  ProactiveResult,
  DelegateToExecutionParams,
  ToolCall,
} from './types';

// Safety & Resilience
export {
  withTimeout,
  withFallback,
  withRetry,
  checkRateLimit,
  getCircuitBreaker,
  CircuitBreaker,
  sanitizeToolArgs,
  validateGoal,
  type RateLimitConfig,
  type RateLimitResult,
} from './safety';
