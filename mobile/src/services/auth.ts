import { api } from './api';
import { storage } from './storage';
import { AuthResponse, User } from '../types';

class AuthService {
  // Apple Sign-In
  async signInWithApple(
    identityToken: string,
    authorizationCode: string,
    name?: string,
    email?: string
  ): Promise<AuthResponse> {
    const response = await api.request<AuthResponse>('/auth/apple', {
      method: 'POST',
      body: {
        identity_token: identityToken,
        authorization_code: authorizationCode,
        name,
        email,
      },
      requiresAuth: false,
    });

    await storage.saveAccessToken(response.access_token);
    await storage.saveRefreshToken(response.refresh_token);

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
        id_token: idToken,
        name,
        email,
      },
      requiresAuth: false,
    });

    await storage.saveAccessToken(response.access_token);
    await storage.saveRefreshToken(response.refresh_token);

    return response;
  }

  // Dev Sign-In (for development only)
  async devSignIn(email: string, name?: string): Promise<AuthResponse> {
    const response = await api.request<AuthResponse>('/auth/dev', {
      method: 'POST',
      body: { email, name },
      requiresAuth: false,
    });

    await storage.saveAccessToken(response.access_token);
    await storage.saveRefreshToken(response.refresh_token);

    return response;
  }

  // Get current user
  async getCurrentUser(): Promise<User> {
    return api.request<User>('/auth/me');
  }

  // Sign out
  async signOut(): Promise<void> {
    await storage.clearAll();
  }

  // Delete account
  async deleteAccount(): Promise<void> {
    await api.request('/auth/account', { method: 'DELETE' });
    await storage.clearAll();
  }

  // Check if user is authenticated
  async isAuthenticated(): Promise<boolean> {
    const token = await storage.getAccessToken();
    return !!token;
  }
}

export const authService = new AuthService();
