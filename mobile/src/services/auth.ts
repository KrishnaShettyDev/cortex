import { api } from './api';
import { storage } from './storage';
import { AuthResponse, User } from '../types';
import { useAppStore } from '../stores/appStore';

class AuthService {
  /**
   * Clear stale data if a different user is logging in.
   * This prevents chat history from leaking between users.
   */
  private async clearStaleDataIfNeeded(newUserId: string): Promise<void> {
    try {
      const existingUserJson = await storage.getUser();
      if (existingUserJson) {
        const existingUser = JSON.parse(existingUserJson);
        if (existingUser.id && existingUser.id !== newUserId) {
          // Different user logging in - clear all persisted app state
          console.log('[Auth] Different user detected, clearing stale data');
          useAppStore.getState().reset();
        }
      }
    } catch (error) {
      // If we can't determine, clear to be safe
      console.warn('[Auth] Could not check existing user, clearing data to be safe');
      useAppStore.getState().reset();
    }
  }

  // Apple Sign-In
  async signInWithApple(
    identityToken: string,
    authorizationCode: string,
    name?: string,
    email?: string
  ): Promise<AuthResponse> {
    // Parse name if provided (format: "FirstName LastName")
    let userObject;
    if (name) {
      const nameParts = name.split(' ');
      userObject = {
        name: {
          givenName: nameParts[0],
          familyName: nameParts.slice(1).join(' ') || nameParts[0],
        },
      };
    }

    const response = await api.request<AuthResponse>('/auth/apple', {
      method: 'POST',
      body: {
        identityToken,
        user: userObject,
      },
      requiresAuth: false,
    });

    // Clear stale data if different user is logging in
    if (response.user?.id) {
      await this.clearStaleDataIfNeeded(response.user.id);
    }

    await storage.saveAccessToken(response.access_token);
    await storage.saveRefreshToken(response.refresh_token);
    if (response.user) {
      await storage.saveUser(JSON.stringify(response.user));
    }

    return response;
  }

  // Google Sign-In
  async signInWithGoogle(
    idToken: string,
    name?: string,
    email?: string
  ): Promise<AuthResponse> {
    const response = await api.request<AuthResponse>('/auth/google', {
      method: 'POST',
      body: {
        idToken,
      },
      requiresAuth: false,
    });

    // Clear stale data if different user is logging in
    if (response.user?.id) {
      await this.clearStaleDataIfNeeded(response.user.id);
    }

    await storage.saveAccessToken(response.access_token);
    await storage.saveRefreshToken(response.refresh_token);
    if (response.user) {
      await storage.saveUser(JSON.stringify(response.user));
    }

    return response;
  }

  // Get current user
  async getCurrentUser(): Promise<User> {
    return api.request<User>('/auth/me');
  }

  // Sign out
  async signOut(): Promise<void> {
    // Clear all persisted app state (including chat messages) to prevent data leakage between users
    useAppStore.getState().reset();
    await storage.clearAll();
  }

  // Delete account
  // NOTE: Backend endpoint DELETE /auth/account not implemented yet
  // This will fail until backend adds the endpoint
  async deleteAccount(): Promise<void> {
    try {
      await api.request('/auth/account', { method: 'DELETE' });
    } catch (error) {
      console.warn('AuthService: deleteAccount endpoint not implemented in backend');
      // Still clear local data
    }
    // Clear all persisted app state (including chat messages) to prevent data leakage between users
    useAppStore.getState().reset();
    await storage.clearAll();
  }

  // Check if user is authenticated
  async isAuthenticated(): Promise<boolean> {
    const token = await storage.getAccessToken();
    return !!token;
  }

  /**
   * Development sign-in (for testing only)
   * @deprecated Should only be used in development mode
   */
  async devSignIn(_email: string, _name?: string): Promise<void> {
    console.warn('AuthService: devSignIn is deprecated and should not be used in production');
    throw new Error('Development sign-in is not available');
  }
}

export const authService = new AuthService();
