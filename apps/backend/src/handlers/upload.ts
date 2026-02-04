/**
 * Upload Handlers
 *
 * Handles file uploads with processing:
 * - Audio: Transcribe with Whisper, create memory
 * - Future: PDF, images, etc.
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import { nanoid } from 'nanoid';
import { createMemory } from '../lib/db/memories';
import { enqueueProcessingJob } from '../lib/queue/producer';
import { createProcessingJob } from '../lib/processing/pipeline';

// Supported audio formats
const SUPPORTED_AUDIO_FORMATS = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/m4a', 'audio/x-m4a'];

// Max file size: 25MB (Whisper limit)
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

interface TranscriptionResult {
  text: string;
  duration?: number;
  language?: string;
}

/**
 * Transcribe audio using Workers AI Whisper model
 */
async function transcribeAudio(
  ai: any,
  audioData: ArrayBuffer,
  mimeType: string
): Promise<TranscriptionResult> {
  try {
    // Call Whisper model
    const result = await ai.run('@cf/openai/whisper-tiny-en', {
      audio: [...new Uint8Array(audioData)],
    });

    return {
      text: result.text || '',
      duration: result.duration,
      language: result.detected_language || 'en',
    };
  } catch (error: any) {
    console.error('[Upload] Whisper transcription failed:', error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

/**
 * POST /v3/upload/audio
 *
 * Upload and transcribe audio, creating a memory from the transcription.
 *
 * Accepts: multipart/form-data with 'audio' field
 * Supported formats: webm, m4a, mp3, wav
 * Max size: 25MB
 *
 * Returns:
 * - memoryId: Created memory ID
 * - transcription: Full text transcription
 * - duration: Audio duration in seconds (if available)
 * - jobId: Processing job ID (if queued)
 */
export async function uploadAudio(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };
  const containerTag = tenantScope.containerTag;

  try {
    // Parse multipart form data
    const formData = await c.req.formData();
    const audioFile = formData.get('audio') as File | null;

    if (!audioFile) {
      return c.json({ error: 'No audio file provided. Use field name "audio".' }, 400);
    }

    // Validate file type
    const mimeType = audioFile.type;
    if (!SUPPORTED_AUDIO_FORMATS.includes(mimeType)) {
      return c.json(
        {
          error: `Unsupported audio format: ${mimeType}`,
          supported: SUPPORTED_AUDIO_FORMATS,
        },
        400
      );
    }

    // Validate file size
    if (audioFile.size > MAX_AUDIO_SIZE) {
      return c.json(
        {
          error: `File too large. Maximum size is ${MAX_AUDIO_SIZE / 1024 / 1024}MB`,
          size: audioFile.size,
          maxSize: MAX_AUDIO_SIZE,
        },
        400
      );
    }

    console.log(`[Upload] Processing audio: ${audioFile.name}, ${audioFile.size} bytes, ${mimeType}`);

    // Read audio data
    const audioData = await audioFile.arrayBuffer();

    // Transcribe with Whisper
    const transcription = await transcribeAudio(c.env.AI, audioData, mimeType);

    if (!transcription.text || transcription.text.trim().length === 0) {
      return c.json(
        {
          error: 'No speech detected in audio',
          duration: transcription.duration,
        },
        400
      );
    }

    console.log(`[Upload] Transcription complete: ${transcription.text.length} chars`);

    // Create memory from transcription
    const memoryId = nanoid();
    const now = new Date().toISOString();

    const memory = await createMemory(c.env.DB, {
      id: memoryId,
      userId,
      containerTag,
      content: transcription.text,
      source: 'voice_recording',
      metadata: {
        source_type: 'audio',
        audio_format: mimeType,
        audio_size: audioFile.size,
        audio_duration: transcription.duration,
        detected_language: transcription.language,
        original_filename: audioFile.name,
        transcribed_at: now,
      },
    });

    console.log(`[Upload] Memory created: ${memoryId}`);

    // Queue for async processing (entity extraction, importance scoring, etc.)
    let jobId: string | null = null;
    let processingMode: 'queue' | 'sync' = 'sync';

    try {
      if (c.env.PROCESSING_QUEUE) {
        // Create processing job and enqueue
        const job = await createProcessingJob(c.env.DB, {
          memoryId,
          userId,
          containerTag,
        });

        await enqueueProcessingJob(c.env.PROCESSING_QUEUE, job);
        jobId = job.id;
        processingMode = 'queue';
        console.log(`[Upload] Processing job queued: ${jobId}`);
      }
    } catch (queueError: any) {
      console.warn(`[Upload] Queue unavailable, processing sync: ${queueError.message}`);
      // Processing will happen via waitUntil in context handler
    }

    return c.json({
      success: true,
      memoryId: memory.id,
      transcription: transcription.text,
      duration: transcription.duration,
      language: transcription.language,
      processingMode,
      jobId,
      metadata: {
        audioFormat: mimeType,
        audioSize: audioFile.size,
        filename: audioFile.name,
      },
    });
  } catch (error: any) {
    console.error('[Upload] Audio upload failed:', error);
    return c.json(
      {
        error: 'Failed to process audio',
        message: error.message,
      },
      500
    );
  }
}

/**
 * POST /upload/audio-with-transcription
 *
 * Mobile app endpoint: Upload audio and return transcription + URL.
 * This is the endpoint the mobile app calls - different from /v3/upload/audio.
 *
 * Accepts: multipart/form-data with 'file' field (mobile uses 'file', not 'audio')
 * Returns: { url, transcription, duration_seconds, language }
 */
export async function uploadAudioWithTranscription(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;

  try {
    const formData = await c.req.formData();
    // Mobile app sends 'file', not 'audio'
    const audioFile = formData.get('file') as File | null;

    if (!audioFile) {
      return c.json({ error: 'No audio file provided. Use field name "file".' }, 400);
    }

    const mimeType = audioFile.type;
    if (!SUPPORTED_AUDIO_FORMATS.includes(mimeType)) {
      return c.json(
        {
          error: `Unsupported audio format: ${mimeType}`,
          supported: SUPPORTED_AUDIO_FORMATS,
        },
        400
      );
    }

    if (audioFile.size > MAX_AUDIO_SIZE) {
      return c.json(
        {
          error: `File too large. Maximum size is ${MAX_AUDIO_SIZE / 1024 / 1024}MB`,
        },
        400
      );
    }

    console.log(`[Upload] Mobile audio: ${audioFile.name}, ${audioFile.size} bytes, ${mimeType}`);

    const audioData = await audioFile.arrayBuffer();
    const transcription = await transcribeAudio(c.env.AI, audioData, mimeType);

    if (!transcription.text || transcription.text.trim().length === 0) {
      return c.json(
        {
          error: 'No speech detected in audio',
          duration_seconds: transcription.duration || null,
        },
        400
      );
    }

    // Upload to R2 for storage
    const audioId = nanoid();
    const audioKey = `audio/${userId}/${audioId}.${mimeType.split('/')[1] || 'webm'}`;

    await c.env.MEDIA.put(audioKey, audioData, {
      httpMetadata: { contentType: mimeType },
    });

    // Generate public URL (R2 custom domain or presigned)
    const audioUrl = `https://media.askcortex.com/${audioKey}`;

    console.log(`[Upload] Audio transcribed and stored: ${transcription.text.length} chars`);

    // Return format expected by mobile app
    return c.json({
      url: audioUrl,
      transcription: transcription.text,
      duration_seconds: transcription.duration || null,
      language: transcription.language || null,
    });
  } catch (error: any) {
    console.error('[Upload] Audio with transcription failed:', error);
    return c.json(
      {
        error: 'Failed to process audio',
        message: error.message,
      },
      500
    );
  }
}

/**
 * POST /upload/photo
 *
 * Mobile app endpoint: Upload photo to R2 storage.
 *
 * Accepts: multipart/form-data with 'file' field
 * Returns: { url }
 */
export async function uploadPhoto(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;

  const SUPPORTED_IMAGE_FORMATS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic'];
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

  try {
    const formData = await c.req.formData();
    const imageFile = formData.get('file') as File | null;

    if (!imageFile) {
      return c.json({ error: 'No image file provided. Use field name "file".' }, 400);
    }

    const mimeType = imageFile.type;
    if (!SUPPORTED_IMAGE_FORMATS.includes(mimeType)) {
      return c.json(
        {
          error: `Unsupported image format: ${mimeType}`,
          supported: SUPPORTED_IMAGE_FORMATS,
        },
        400
      );
    }

    if (imageFile.size > MAX_IMAGE_SIZE) {
      return c.json(
        {
          error: `File too large. Maximum size is ${MAX_IMAGE_SIZE / 1024 / 1024}MB`,
        },
        400
      );
    }

    console.log(`[Upload] Photo: ${imageFile.name}, ${imageFile.size} bytes, ${mimeType}`);

    const imageData = await imageFile.arrayBuffer();

    // Upload to R2
    const imageId = nanoid();
    const extension = mimeType.split('/')[1] || 'jpg';
    const imageKey = `photos/${userId}/${imageId}.${extension}`;

    await c.env.MEDIA.put(imageKey, imageData, {
      httpMetadata: { contentType: mimeType },
    });

    const imageUrl = `https://media.askcortex.com/${imageKey}`;

    console.log(`[Upload] Photo stored: ${imageUrl}`);

    return c.json({ url: imageUrl });
  } catch (error: any) {
    console.error('[Upload] Photo upload failed:', error);
    return c.json(
      {
        error: 'Failed to upload photo',
        message: error.message,
      },
      500
    );
  }
}

/**
 * POST /v3/upload/text
 *
 * Quick text upload for creating memories.
 * Simpler alternative to /v3/memories for mobile.
 */
export async function uploadText(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };
  const containerTag = tenantScope.containerTag;

  try {
    const body = await c.req.json();
    const { text, source = 'quick_note' } = body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return c.json({ error: 'Text content is required' }, 400);
    }

    // Create memory
    const memoryId = nanoid();
    const memory = await createMemory(c.env.DB, {
      id: memoryId,
      userId,
      containerTag,
      content: text.trim(),
      source,
      metadata: {
        source_type: 'text',
        created_via: 'upload_api',
      },
    });

    // Queue for processing
    let jobId: string | null = null;
    if (c.env.PROCESSING_QUEUE) {
      try {
        const job = await createProcessingJob(c.env.DB, {
          memoryId,
          userId,
          containerTag,
        });
        await enqueueProcessingJob(c.env.PROCESSING_QUEUE, job);
        jobId = job.id;
      } catch (e) {
        console.warn('[Upload] Queue unavailable for text upload');
      }
    }

    return c.json({
      success: true,
      memoryId: memory.id,
      content: memory.content,
      jobId,
    });
  } catch (error: any) {
    console.error('[Upload] Text upload failed:', error);
    return c.json({ error: 'Failed to save text', message: error.message }, 500);
  }
}
