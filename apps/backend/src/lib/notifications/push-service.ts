/**
 * Expo Push Notification Service
 *
 * Sends push notifications via Expo's push notification service.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

export interface PushMessage {
  to: string; // Expo push token
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  ttl?: number; // Time to live in seconds
  expiration?: number; // Unix timestamp
}

export interface PushTicket {
  id?: string;
  status: 'ok' | 'error';
  message?: string;
  details?: {
    error?: 'DeviceNotRegistered' | 'MessageTooBig' | 'MessageRateExceeded' | 'InvalidCredentials';
  };
}

export interface PushReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: {
    error?: string;
  };
}

/**
 * Send push notifications via Expo
 * Supports batching up to 100 notifications per request
 */
export async function sendPushNotifications(
  messages: PushMessage[]
): Promise<{ tickets: PushTicket[]; errors: string[] }> {
  const errors: string[] = [];
  const allTickets: PushTicket[] = [];

  // Batch messages (Expo allows up to 100 per request)
  const batches = chunk(messages, 100);

  for (const batch of batches) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        const errorText = await response.text();
        errors.push(`Expo API error: ${response.status} - ${errorText}`);
        continue;
      }

      const result = await response.json() as { data: PushTicket[] };
      allTickets.push(...result.data);

      // Log any ticket-level errors
      result.data.forEach((ticket, index) => {
        if (ticket.status === 'error') {
          const token = batch[index]?.to || 'unknown';
          errors.push(`Push failed for ${token}: ${ticket.message} (${ticket.details?.error})`);
        }
      });
    } catch (error: any) {
      errors.push(`Network error sending push: ${error.message}`);
    }
  }

  return { tickets: allTickets, errors };
}

/**
 * Get push receipts to check delivery status
 */
export async function getPushReceipts(
  ticketIds: string[]
): Promise<{ receipts: Record<string, PushReceipt>; errors: string[] }> {
  const errors: string[] = [];
  const allReceipts: Record<string, PushReceipt> = {};

  // Batch ticket IDs (up to 1000 per request)
  const batches = chunk(ticketIds, 1000);

  for (const batch of batches) {
    try {
      const response = await fetch(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: batch }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        errors.push(`Expo receipts API error: ${response.status} - ${errorText}`);
        continue;
      }

      const result = await response.json() as { data: Record<string, PushReceipt> };
      Object.assign(allReceipts, result.data);
    } catch (error: any) {
      errors.push(`Network error getting receipts: ${error.message}`);
    }
  }

  return { receipts: allReceipts, errors };
}

/**
 * Send a single push notification
 */
export async function sendPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, any>,
  options?: {
    channelId?: string;
    badge?: number;
    sound?: 'default' | null;
    priority?: 'default' | 'normal' | 'high';
  }
): Promise<{ success: boolean; ticketId?: string; error?: string }> {
  const message: PushMessage = {
    to: token,
    title,
    body,
    data,
    sound: options?.sound ?? 'default',
    channelId: options?.channelId ?? 'default',
    priority: options?.priority ?? 'high',
  };

  if (options?.badge !== undefined) {
    message.badge = options.badge;
  }

  const { tickets, errors } = await sendPushNotifications([message]);

  if (errors.length > 0) {
    return { success: false, error: errors[0] };
  }

  const ticket = tickets[0];
  if (!ticket) {
    return { success: false, error: 'No ticket returned' };
  }

  if (ticket.status === 'error') {
    return {
      success: false,
      error: ticket.message || ticket.details?.error || 'Unknown error',
    };
  }

  return { success: true, ticketId: ticket.id };
}

/**
 * Validate if a token is a valid Expo push token
 */
export function isValidExpoPushToken(token: string): boolean {
  return token.startsWith('ExponentPushToken[') && token.endsWith(']');
}

/**
 * Split array into chunks
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
