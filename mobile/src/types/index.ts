// User types
export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

// Auth types
export interface AuthResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
  is_new_user: boolean;
}

// Memory types
export interface Memory {
  id: string;
  content: string;
  summary: string | null;
  memory_type: 'voice' | 'text' | 'photo' | 'email' | 'calendar';
  source_id: string | null;
  source_url: string | null;
  audio_url: string | null;
  photo_url: string | null;
  memory_date: string;
  created_at: string;
  entities: string[];
}

export interface MemoryCreateResponse {
  memory_id: string;
  entities_extracted: string[];
}

export interface MemoryListResponse {
  memories: Memory[];
  total: number;
  offset: number;
  limit: number;
}

export interface MemorySearchResponse {
  memories: Memory[];
  query_understood: string;
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
}

export interface MemoryReference {
  id: string;
  content: string;
  memory_type: string;
  memory_date: string;
  photo_url?: string | null;
  audio_url?: string | null;
}

export interface ActionTaken {
  tool: string;
  arguments: Record<string, any>;
  result: {
    success: boolean;
    message: string;
    event_id?: string;
    event_url?: string;
    message_id?: string;
    thread_id?: string;
  };
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
