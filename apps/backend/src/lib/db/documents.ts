/**
 * Document Database Operations
 *
 * Handles knowledge base documents:
 * - Document upload and storage
 * - Smart chunking
 * - Processing status tracking
 * - Container scoping
 */

import { nanoid } from 'nanoid';

export interface Document {
  id: string;
  user_id: string;
  title: string;
  content: string;
  source_type: 'pdf' | 'url' | 'code' | 'text' | 'image';
  source_url: string | null;
  container_tag: string;
  status: 'queued' | 'extracting' | 'chunking' | 'embedding' | 'done' | 'failed';
  error_message: string | null;
  file_size: number | null;
  mime_type: string | null;
  metadata: string | null; // JSON
  created_at: string;
  updated_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  chunk_type: string | null; // 'section', 'paragraph', 'code_block', 'table'
  start_offset: number | null;
  end_offset: number | null;
  created_at: string;
}

export interface CreateDocumentOptions {
  userId: string;
  title: string;
  content: string;
  sourceType: Document['source_type'];
  sourceUrl?: string;
  containerTag?: string;
  fileSize?: number;
  mimeType?: string;
  metadata?: Record<string, any>;
}

/**
 * Create a new document
 */
export async function createDocument(
  db: D1Database,
  options: CreateDocumentOptions
): Promise<Document> {
  const id = nanoid();
  const now = new Date().toISOString();

  const document: Document = {
    id,
    user_id: options.userId,
    title: options.title,
    content: options.content,
    source_type: options.sourceType,
    source_url: options.sourceUrl || null,
    container_tag: options.containerTag || 'default',
    status: 'queued',
    error_message: null,
    file_size: options.fileSize || null,
    mime_type: options.mimeType || null,
    metadata: options.metadata ? JSON.stringify(options.metadata) : null,
    created_at: now,
    updated_at: now,
  };

  await db
    .prepare(
      `INSERT INTO documents (id, user_id, title, content, source_type, source_url, container_tag, status, error_message, file_size, mime_type, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      document.id,
      document.user_id,
      document.title,
      document.content,
      document.source_type,
      document.source_url,
      document.container_tag,
      document.status,
      document.error_message,
      document.file_size,
      document.mime_type,
      document.metadata,
      document.created_at,
      document.updated_at
    )
    .run();

  return document;
}

/**
 * Update document status
 */
export async function updateDocumentStatus(
  db: D1Database,
  documentId: string,
  status: Document['status'],
  errorMessage?: string
): Promise<void> {
  const now = new Date().toISOString();

  await db
    .prepare(
      'UPDATE documents SET status = ?, error_message = ?, updated_at = ? WHERE id = ?'
    )
    .bind(status, errorMessage || null, now, documentId)
    .run();
}

/**
 * Get document by ID
 */
export async function getDocumentById(
  db: D1Database,
  documentId: string
): Promise<Document | null> {
  const result = await db
    .prepare('SELECT * FROM documents WHERE id = ?')
    .bind(documentId)
    .first<Document>();

  return result;
}

/**
 * List documents for a user
 */
export async function listDocuments(
  db: D1Database,
  userId: string,
  options?: {
    containerTag?: string;
    status?: Document['status'];
    limit?: number;
    offset?: number;
  }
): Promise<Document[]> {
  let query = 'SELECT * FROM documents WHERE user_id = ?';
  const params: any[] = [userId];

  if (options?.containerTag) {
    query += ' AND container_tag = ?';
    params.push(options.containerTag);
  }

  if (options?.status) {
    query += ' AND status = ?';
    params.push(options.status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(options?.limit || 50, options?.offset || 0);

  const result = await db.prepare(query).bind(...params).all<Document>();
  return result.results || [];
}

/**
 * Delete document
 */
export async function deleteDocument(
  db: D1Database,
  documentId: string
): Promise<void> {
  // Chunks will be deleted via CASCADE
  await db.prepare('DELETE FROM documents WHERE id = ?').bind(documentId).run();
}

/**
 * Create document chunks
 */
export async function createDocumentChunks(
  db: D1Database,
  documentId: string,
  chunks: Array<{
    content: string;
    chunkType?: string;
    startOffset?: number;
    endOffset?: number;
  }>
): Promise<DocumentChunk[]> {
  const now = new Date().toISOString();
  const createdChunks: DocumentChunk[] = [];

  // Batch insert chunks
  const statements = chunks.map((chunk, index) => {
    const id = nanoid();
    const documentChunk: DocumentChunk = {
      id,
      document_id: documentId,
      chunk_index: index,
      content: chunk.content,
      chunk_type: chunk.chunkType || null,
      start_offset: chunk.startOffset || null,
      end_offset: chunk.endOffset || null,
      created_at: now,
    };

    createdChunks.push(documentChunk);

    return db
      .prepare(
        `INSERT INTO document_chunks (id, document_id, chunk_index, content, chunk_type, start_offset, end_offset, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        documentChunk.id,
        documentChunk.document_id,
        documentChunk.chunk_index,
        documentChunk.content,
        documentChunk.chunk_type,
        documentChunk.start_offset,
        documentChunk.end_offset,
        documentChunk.created_at
      );
  });

  await db.batch(statements);

  return createdChunks;
}

/**
 * Get document chunks
 */
export async function getDocumentChunks(
  db: D1Database,
  documentId: string
): Promise<DocumentChunk[]> {
  const result = await db
    .prepare(
      'SELECT * FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC'
    )
    .bind(documentId)
    .all<DocumentChunk>();

  return result.results || [];
}

/**
 * Search documents by title or content (simple text search)
 */
export async function searchDocuments(
  db: D1Database,
  userId: string,
  query: string,
  options?: {
    containerTag?: string;
    limit?: number;
  }
): Promise<Document[]> {
  let sql = `
    SELECT * FROM documents
    WHERE user_id = ?
      AND status = 'done'
      AND (title LIKE ? OR content LIKE ?)
  `;
  const params: any[] = [userId, `%${query}%`, `%${query}%`];

  if (options?.containerTag) {
    sql += ' AND container_tag = ?';
    params.push(options.containerTag);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(options?.limit || 20);

  const result = await db.prepare(sql).bind(...params).all<Document>();
  return result.results || [];
}

/**
 * Search document chunks by content
 */
export async function searchChunks(
  db: D1Database,
  userId: string,
  query: string,
  options?: {
    containerTag?: string;
    limit?: number;
  }
): Promise<DocumentChunk[]> {
  let sql = `
    SELECT dc.* FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE d.user_id = ?
      AND d.status = 'done'
      AND dc.content LIKE ?
  `;
  const params: any[] = [userId, `%${query}%`];

  if (options?.containerTag) {
    sql += ' AND d.container_tag = ?';
    params.push(options.containerTag);
  }

  sql += ' ORDER BY dc.created_at DESC LIMIT ?';
  params.push(options?.limit || 20);

  const result = await db.prepare(sql).bind(...params).all<DocumentChunk>();
  return result.results || [];
}
