// User types
export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

// Auth types
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    name?: string;
  };
}

// Memory types
export interface Memory {
  id: string;
  user_id: string;
  content: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  metadata?: {
    entities?: string[];
    location_lat?: number;
    location_lon?: number;
    location_name?: string;
    people?: string[];
    tags?: string[];
    timestamp?: string;
  };
}

export interface CreateMemoryInput {
  content: string;
  source?: string;
  metadata?: {
    entities?: string[];
    location_lat?: number;
    location_lon?: number;
    location_name?: string;
    people?: string[];
    tags?: string[];
    timestamp?: string;
  };
}

export interface MemoryListResponse {
  memories: Memory[];
  total: number;
}

export interface MemorySearchResponse {
  results: Memory[];
  count: number;
}

// Entity types
export interface Entity {
  id: string;
  name: string;
  entity_type: 'person' | 'place' | 'company' | 'topic' | 'event';
  email: string | null;
  mention_count: number;
}

// Chat types
export interface ReasoningStep {
  step: string;
  message: string;
  tool?: string;
  count?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  memoriesUsed?: MemoryReference[];
  actionsTaken?: ActionTaken[];
  pendingActions?: PendingAction[];
  reasoningSteps?: ReasoningStep[];
  timestamp: Date;
  // Cognitive layer tracking
  outcomeId?: string; // For feedback tracking
  feedbackGiven?: 'positive' | 'negative' | 'neutral';
  sources?: {
    memories: number;
    learnings: number;
    beliefs: number;
  };
  // Proactive message flags (Poke/Iris-style)
  isProactive?: boolean;
  proactiveType?: 'notification' | 'briefing' | 'reminder' | 'insight' | 'action_result';
  metadata?: Record<string, any>;
}

export interface MemoryReference {
  id: string;
  content: string;
  memory_type: string;
  memory_date: string;
  photo_url?: string | null;
  audio_url?: string | null;
}

export interface ActionResult {
  success?: boolean;
  message?: string;
  event_id?: string;
  event_url?: string;
  message_id?: string;
  thread_id?: string;
  // Additional result properties for different tools
  free_slots?: Array<{ start_time: string; end_time: string }>;
  places?: Array<{ name: string; address: string }>;
  emails?: Array<{ id: string; subject: string; from?: string; date?: string; snippet?: string; is_unread?: boolean; thread_id?: string }>;
  messages?: Array<{ id: string; content?: string; subject?: string; from?: string; date?: string; snippet?: string }>;
  events?: Array<{ id: string; title?: string; start_time?: string; end_time?: string; location?: string; attendees?: string[]; event_url?: string }>;
  // Allow additional dynamic properties
  [key: string]: unknown;
}

export interface ActionTaken {
  tool: string;
  arguments: Record<string, any>;
  result: ActionResult;
}

export interface PendingAction {
  action_id: string;
  tool: string;
  arguments: Record<string, any>;
}

export interface ChatResponse {
  response: string;
  conversation_id: string;
  memories_used: MemoryReference[];
  actions_taken: ActionTaken[];
  pending_actions: PendingAction[];
}

export interface ExecuteActionRequest {
  action_id: string;
  tool: string;
  arguments: Record<string, any>;
  modified_arguments?: Record<string, any>;
}

export interface ExecuteActionResponse {
  success: boolean;
  message: string;
  result?: Record<string, any>;
}

// Smart Suggestions
// Service icons for connected apps via Composio
export type ServiceIcon =
  | 'gmail'
  | 'calendar'
  | 'gmail-calendar'
  | 'drive'
  | 'docs'
  | 'sheets'
  | 'slides'
  | 'slack'
  | 'notion'
  | 'outlook'
  | 'teams'
  | 'github'
  | 'linear'
  | 'jira'
  | 'asana'
  | 'trello'
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'spotify'
  | 'note'
  | 'none';

export interface SmartSuggestion {
  text: string;
  services: ServiceIcon;
  context: string | null;
  source_id: string | null;
}

export interface SmartSuggestionsResponse {
  suggestions: SmartSuggestion[];
  gmail_connected: boolean;
  calendar_connected: boolean;
  connected_apps: ServiceIcon[];  // List of all connected app names
}

// Greeting
export interface GreetingResponse {
  greeting: string;
  has_context: boolean;
}

// API Error
export interface ApiError {
  detail: string;
}

// Raw API Response Types (for mapping to local types)
export interface RawEmailResponse {
  id: string;
  thread_id?: string;
  subject?: string;
  from?: string;
  to?: string[];
  date?: string;
  snippet?: string;
  body?: string;
  is_unread?: boolean;
  is_starred?: boolean;
  is_important?: boolean;
  labels?: string[];
  attachment_count?: number;
  content?: string;
}

export interface RawCalendarEventResponse {
  id: string;
  title?: string;
  summary?: string;
  start_time?: string;
  start?: string;
  end_time?: string;
  end?: string;
  location?: string;
  attendees?: string[];
  event_url?: string;
  htmlLink?: string;
}

export interface RawTimeSlotResponse {
  start: string;
  end: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
}

export interface RawPlaceResponse {
  name: string;
  address?: string;
  formatted_address?: string;
  rating?: number;
  price_level?: number;
  types?: string[];
}

// People Intelligence Types
export interface PersonSummary {
  id: string;
  name: string;
  entity_type: string;
  email: string | null;
  mention_count: number;
  first_seen: string | null;
  last_seen: string | null;
}

export interface PersonProfile {
  name: string;
  entity_type: string;
  email: string | null;
  mention_count: number;
  first_seen: string | null;
  last_seen: string | null;
  summary: string | null;
  relationship_type: string | null;
  topics: string[];
  sentiment_trend: string | null;
  last_interaction_date: string | null;
  next_meeting_date: string | null;
  recent_memories: MemoryBrief[];
}

export interface MemoryBrief {
  id: string;
  content: string;
  memory_type: string;
  memory_date: string | null;
  summary?: string | null;
}

export interface PeopleListResponse {
  people: PersonSummary[];
  total: number;
}

export interface PersonMemoriesResponse {
  memories: MemoryBrief[];
  total: number;
}

export interface MeetingContextResponse {
  person_name: string;
  context: string | null;
}

// Connection Types
export interface MemoryConnection {
  id: string;
  connection_type: string;
  strength: number;
  explanation: string | null;
  created_at: string;
  memory_1: MemoryBrief;
  memory_2: MemoryBrief;
}

export interface ConnectionListResponse {
  connections: MemoryConnection[];
  total: number;
}

export interface DismissResponse {
  success: boolean;
  message: string;
}

// ==================== PROACTIVE INSIGHTS ====================

export interface RelationshipInsight {
  entity_id: string;
  name: string;
  days_since_contact: number;
  health_score: number;
  tier: string;
  reason: string;
  suggested_action: string | null;
}

export interface IntentionInsight {
  id: string;
  description: string;
  target_person: string | null;
  due_date: string | null;
  days_overdue: number | null;
  is_overdue: boolean;
  priority_score: number;
}

export interface PatternInsight {
  id: string;
  name: string;
  description: string;
  trigger: string;
  consequence: string | null;
  valence: 'positive' | 'negative' | 'neutral';
  confidence: number;
  warning_message: string | null;
  is_active: boolean;
}

export interface PromiseInsight {
  id: string;
  person_name: string;
  entity_id: string;
  description: string;
  made_on: string;
  due_date: string | null;
  days_until_due: number | null;
  is_overdue: boolean;
  importance: number;
}

export interface ImportantDateInsight {
  id: string;
  person_name: string;
  entity_id: string;
  date_type: string;
  date_label: string;
  date: string;
  days_until: number;
  years: number | null;
  notes: string | null;
}

export interface EmotionalInsight {
  avg_valence: number | null;
  avg_arousal: number | null;
  top_emotion: string | null;
  trend: 'positive' | 'stable' | 'declining' | null;
  flashbulb_count: number;
}

export interface ProactiveInsightsResponse {
  neglected_relationships: RelationshipInsight[];
  upcoming_dates: ImportantDateInsight[];
  pending_intentions: IntentionInsight[];
  pending_promises: PromiseInsight[];
  pattern_warnings: PatternInsight[];
  emotional_state: EmotionalInsight | null;
  total_attention_needed: number;
  has_urgent: boolean;
}

// ==================== DAILY BRIEFING ====================

export interface BriefingItem {
  id: string;
  type: 'calendar' | 'email' | 'reminder' | 'pattern' | 'deadline' | 'memory' | 'meeting' | 'test';
  title: string;
  subtitle: string;
  urgency_score: number;
  action_prompt: string;
  icon: string;
  urgency?: 'high' | 'medium' | 'low';
  action_label?: string;
  source_id?: string;
  metadata?: Record<string, any>;
}

export interface DailyBriefingResponse {
  items: BriefingItem[];
  total_count: number;
  has_urgent: boolean;
  generated_at: string;
}

// ==================== AUTONOMOUS ACTIONS ====================

export type AutonomousActionType =
  | 'email_reply'
  | 'email_compose'
  | 'calendar_create'
  | 'calendar_reschedule'
  | 'calendar_cancel'
  | 'meeting_prep'
  | 'reminder_create'
  | 'task_create'
  | 'followup';

export interface EmailPayload {
  thread_id: string;
  to: string;
  subject: string;
  body: string;
}

export interface CalendarPayload {
  event_id?: string;
  title: string;
  start_time: string;
  end_time: string;
  description?: string;
  location?: string;
  attendees?: string[];
}

export interface MeetingPrepPayload {
  event_id: string;
  event_title: string;
  start_time: string;
  attendees?: string[];
}

export type ActionPayload = EmailPayload | CalendarPayload | MeetingPrepPayload;

export interface AutonomousAction {
  id: string;
  action_type: AutonomousActionType;
  title: string;
  description: string | null;
  action_payload: ActionPayload;
  reason: string | null;
  confidence_score: number;
  priority_score: number;
  source_type: string | null;
  source_id: string | null;
  status: 'pending' | 'approved' | 'dismissed' | 'expired' | 'executed' | 'failed';
  created_at: string;
  expires_at: string | null;
}

export interface AutonomousActionsResponse {
  actions: AutonomousAction[];
  count: number;
}

export interface ActionExecutionResult {
  success: boolean;
  message: string;
  event_id?: string;
  event_url?: string;
  message_id?: string;
  thread_id?: string;
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
  pending: number;
  executed: number;
  dismissed: number;
  expired: number;
  total: number;
  approval_rate: number;
}
