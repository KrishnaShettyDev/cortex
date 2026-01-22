import { API_BASE_URL } from './constants';
import { storage } from './storage';
import { logger } from '../utils/logger';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  requiresAuth?: boolean;
}

// Streaming event types matching backend SSE format
export interface StreamEvent {
  type: 'memories' | 'content' | 'pending_actions' | 'status' | 'done' | 'error';
  data: any;
}

// Status update for real-time reasoning display
export interface StatusUpdate {
  step: string;
  message: string;
  tool?: string;
  count?: number;
}

export interface StreamCallbacks {
  onMemories?: (memories: any[]) => void;
  onContent?: (content: string) => void;
  onPendingActions?: (actions: any[]) => void;
  onStatus?: (status: StatusUpdate) => void;
  onDone?: (data: { conversation_id: string }) => void;
  onError?: (error: string) => void;
}

interface UploadWithTranscriptionResponse {
  url: string;
  transcription: string;
  duration_seconds: number | null;
  language: string | null;
}

class ApiService {
  private baseUrl = API_BASE_URL;

  /**
   * Upload audio file and get transcription
   */
  async uploadAudioWithTranscription(audioUri: string): Promise<UploadWithTranscriptionResponse> {
    const token = await storage.getAccessToken();

    // Create form data
    const formData = new FormData();

    // Get file info from URI - handle both regular paths and file:// URIs
    const cleanUri = audioUri.replace('file://', '');
    const uriParts = cleanUri.split('.');
    const fileExtension = uriParts[uriParts.length - 1].toLowerCase();

    // Determine MIME type
    const mimeTypes: Record<string, string> = {
      'm4a': 'audio/m4a',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'webm': 'audio/webm',
      'caf': 'audio/x-caf',
      'aac': 'audio/aac',
      'mp4': 'audio/mp4',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
    };
    const mimeType = mimeTypes[fileExtension] || 'audio/wav';

    logger.log(`API: File extension: ${fileExtension}, MIME type: ${mimeType}`);

    formData.append('file', {
      uri: audioUri,
      name: `recording.${fileExtension}`,
      type: mimeType,
    } as any);

    logger.log(`API: Uploading audio for transcription from ${audioUri}`);

    const response = await fetch(`${this.baseUrl}/upload/audio-with-transcription`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        // Don't set Content-Type - let fetch set it with boundary for FormData
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('API: Upload failed:', errorText);
      throw new Error(this.parseError(errorText));
    }

    const data = await response.json();
    logger.log('API: Audio uploaded and transcribed successfully');
    return data;
  }

  /**
   * Upload a photo and return the URL
   */
  async uploadPhoto(imageUri: string): Promise<string> {
    const token = await storage.getAccessToken();

    const formData = new FormData();

    // Get file extension from URI
    const cleanUri = imageUri.replace('file://', '');
    const uriParts = cleanUri.split('.');
    const fileExtension = uriParts[uriParts.length - 1].toLowerCase();

    // Determine MIME type
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'heic': 'image/heic',
    };
    const mimeType = mimeTypes[fileExtension] || 'image/jpeg';

    formData.append('file', {
      uri: imageUri,
      name: `photo.${fileExtension}`,
      type: mimeType,
    } as any);

    logger.log(`API: Uploading photo from ${imageUri}`);

    const response = await fetch(`${this.baseUrl}/upload/photo`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('API: Photo upload failed:', errorText);
      throw new Error(this.parseError(errorText));
    }

    const data = await response.json();
    logger.log('API: Photo uploaded successfully');
    return data.url;
  }

  // Fetch with timeout wrapper
  private async fetchWithTimeout(url: string, config: RequestInit, timeoutMs = 10000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...config,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, requiresAuth = true } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (requiresAuth) {
      const token = await storage.getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        logger.warn('API: No auth token available for authenticated request');
      }
    }

    const config: RequestInit = {
      method,
      headers,
    };

    if (body) {
      config.body = JSON.stringify(body);
    }

    logger.log(`API: ${method} ${this.baseUrl}${endpoint}`);

    // Use longer timeout for endpoints that may take time
    // - Chat endpoints: AI responses can take time
    // - Calendar endpoints: Composio API calls may be slow
    // - Integrations endpoints: OAuth and sync operations
    // - Feedback endpoints: LLM preference extraction
    // Note: /memories is now fast (<100ms) - processing happens in background
    let timeoutMs = 10000; // Default 10 seconds
    if (endpoint.includes('/chat')) {
      timeoutMs = 60000; // 60 seconds for chat
    } else if (endpoint.includes('/calendar') || endpoint.includes('/integrations') || endpoint.includes('/feedback')) {
      timeoutMs = 45000; // 45 seconds for calendar, integrations, and feedback (Composio can be slow)
    }

    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}${endpoint}`, config, timeoutMs);

      if (response.status === 401 && requiresAuth) {
        // Token expired, try to refresh
        logger.log('API: 401 received, attempting token refresh');
        const refreshed = await this.refreshToken();
        if (refreshed) {
          // Retry the request with new token
          const newToken = await storage.getAccessToken();
          headers['Authorization'] = `Bearer ${newToken}`;
          const retryResponse = await this.fetchWithTimeout(`${this.baseUrl}${endpoint}`, {
            ...config,
            headers,
          }, timeoutMs);
          if (!retryResponse.ok) {
            const errorText = await retryResponse.text();
            logger.error('API: Retry failed:', errorText);
            throw new Error(this.parseError(errorText));
          }
          return retryResponse.json();
        }
        throw new Error('Session expired. Please log in again.');
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`API: Error ${response.status}:`, errorText);
        throw new Error(this.parseError(errorText));
      }

      const data = await response.json();
      logger.log(`API: Success ${method} ${endpoint}`);
      return data;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.warn('API: Request timed out');
        throw new Error('Request timed out. Please check your connection and try again.');
      }
      if (error.message?.includes('Network request failed')) {
        logger.warn('API: Network request failed');
        throw new Error('Cannot connect to server. Please check your connection.');
      }
      throw error;
    }
  }

  private parseError(errorText: string): string {
    try {
      const parsed = JSON.parse(errorText);
      if (parsed.detail) {
        if (Array.isArray(parsed.detail)) {
          // Pydantic validation error
          return parsed.detail.map((d: any) => d.msg).join(', ');
        }
        return parsed.detail;
      }
      return errorText;
    } catch {
      return errorText || 'Unknown error';
    }
  }

  private async refreshToken(): Promise<boolean> {
    const refreshToken = await storage.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      await storage.saveAccessToken(data.access_token);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Make a streaming request using Server-Sent Events (SSE).
   * Falls back to batch processing in React Native where true streaming isn't available.
   */
  async streamRequest(
    endpoint: string,
    body: any,
    callbacks: StreamCallbacks
  ): Promise<void> {
    let token = await storage.getAccessToken();

    logger.log(`API: Streaming POST ${this.baseUrl}${endpoint}`);

    const makeRequest = async (authToken: string | null) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      return this.fetchWithTimeout(
        `${this.baseUrl}${endpoint}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        },
        90000
      );
    };

    try {
      let response = await makeRequest(token);

      // Handle 401 - try to refresh token
      if (response.status === 401) {
        logger.log('API: Stream 401 received, attempting token refresh');
        const refreshed = await this.refreshToken();
        if (refreshed) {
          token = await storage.getAccessToken();
          response = await makeRequest(token);
        } else {
          callbacks.onError?.('Session expired. Please log in again.');
          return;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`API: Stream error ${response.status}:`, errorText);
        callbacks.onError?.(this.parseError(errorText));
        return;
      }

      // Read the full response and process events
      const text = await response.text();
      logger.log('API: Received stream response, processing events...');

      // Parse all events first
      const events: StreamEvent[] = [];
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event: StreamEvent = JSON.parse(data);
            events.push(event);
          } catch (e) {
            // Not JSON, skip
          }
        }
      }

      // Process events with delays for status updates to show real-time feel
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        logger.log('API: Processing event:', event.type);

        // Add delay before status events so user can see them
        if (event.type === 'status') {
          // Give more time to see each step
          await new Promise(resolve => setTimeout(resolve, 400));
        }

        this.handleStreamEvent(event, callbacks);

        // Delay after status events to let UI render
        if (event.type === 'status') {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      logger.log('API: Stream processing complete');
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.warn('API: Stream request timed out');
        callbacks.onError?.('Request timed out. The server may be busy, please try again.');
      } else if (error.message?.includes('Network request failed')) {
        logger.warn('API: Network request failed');
        callbacks.onError?.('Cannot connect to server. Please check your connection.');
      } else {
        logger.error('API: Stream request failed:', error);
        callbacks.onError?.(error.message || 'Stream request failed');
      }
    }
  }

  /**
   * Fallback SSE handler for environments without ReadableStream (React Native)
   */
  private async handleSSETextFallback(
    response: Response,
    callbacks: StreamCallbacks
  ): Promise<void> {
    try {
      const text = await response.text();
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            continue;
          }

          try {
            const event: StreamEvent = JSON.parse(data);
            this.handleStreamEvent(event, callbacks);
          } catch (e) {
            // Not JSON, might be raw content
            if (data) {
              callbacks.onContent?.(data);
            }
          }
        }
      }
    } catch (error: any) {
      logger.error('API: SSE text fallback error:', error);
      callbacks.onError?.(error.message);
    }
  }

  /**
   * Handle Server-Sent Events stream
   */
  private async handleSSEStream(
    response: Response,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError?.('No response body');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              continue;
            }

            try {
              const event: StreamEvent = JSON.parse(data);
              this.handleStreamEvent(event, callbacks);
            } catch (e) {
              // Not JSON, might be raw content
              if (data) {
                callbacks.onContent?.(data);
              }
            }
          }
        }
      }
    } catch (error: any) {
      logger.error('API: SSE stream error:', error);
      callbacks.onError?.(error.message);
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Handle individual stream events (matches backend format)
   */
  private handleStreamEvent(event: StreamEvent, callbacks: StreamCallbacks): void {
    logger.log('API: Stream event:', event.type);
    switch (event.type) {
      case 'memories':
        callbacks.onMemories?.(event.data);
        break;
      case 'content':
        callbacks.onContent?.(event.data);
        break;
      case 'pending_actions':
        callbacks.onPendingActions?.(event.data);
        break;
      case 'status':
        logger.log('API: Received status event:', event.data);
        callbacks.onStatus?.(event.data);
        break;
      case 'done':
        callbacks.onDone?.(event.data);
        break;
      case 'error':
        callbacks.onError?.(event.data);
        break;
    }
  }
}

export const api = new ApiService();
