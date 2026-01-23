import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from './constants';
import { logger } from '../utils/logger';

class StorageService {
  async getAccessToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN);
    } catch {
      return null;
    }
  }

  async saveAccessToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEYS.ACCESS_TOKEN, token);
  }

  async getRefreshToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN);
    } catch {
      return null;
    }
  }

  async saveRefreshToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEYS.REFRESH_TOKEN, token);
  }

  async clearTokens(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.ACCESS_TOKEN);
    await SecureStore.deleteItemAsync(STORAGE_KEYS.REFRESH_TOKEN);
  }

  async getUser(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(STORAGE_KEYS.USER);
    } catch {
      return null;
    }
  }

  async saveUser(user: string): Promise<void> {
    await SecureStore.setItemAsync(STORAGE_KEYS.USER, user);
  }

  async clearUser(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.USER);
  }

  async clearAll(): Promise<void> {
    await this.clearTokens();
    await this.clearUser();
  }

  // Generic key-value storage methods
  async set(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      logger.warn('Storage set failed:', error);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      logger.warn('Storage remove failed:', error);
    }
  }
}

export const storage = new StorageService();
