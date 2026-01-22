import SwiftUI
import Combine

@MainActor
class AppState: ObservableObject {
    @Published var isAuthenticated: Bool = false
    @Published var user: User?
    @Published var isLoading: Bool = false
    @Published var error: String?

    private let authService = AuthService.shared
    private let keychainService = KeychainService.shared

    init() {
        // Check for existing authentication
        Task {
            await checkAuthentication()
        }
    }

    func checkAuthentication() async {
        if let _ = keychainService.getAccessToken() {
            isAuthenticated = true
            await fetchCurrentUser()
        }
    }

    func signInWithApple(identityToken: String, authorizationCode: String, name: String?, email: String?) async {
        isLoading = true
        error = nil

        do {
            let response = try await authService.signInWithApple(
                identityToken: identityToken,
                authorizationCode: authorizationCode,
                name: name,
                email: email
            )

            keychainService.saveAccessToken(response.accessToken)
            keychainService.saveRefreshToken(response.refreshToken)

            isAuthenticated = true
            await fetchCurrentUser()
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    // Google Sign-In (placeholder - uses dev auth for now since Google Sign-In requires SDK setup)
    func signInWithGoogle() async {
        // For now, use dev auth as a placeholder
        // In production, integrate GoogleSignIn SDK
        isLoading = true
        error = nil

        do {
            // Using dev auth as placeholder
            let response = try await authService.devSignIn(
                email: "google_user@gmail.com",
                name: "Google User"
            )

            keychainService.saveAccessToken(response.accessToken)
            keychainService.saveRefreshToken(response.refreshToken)

            isAuthenticated = true
            await fetchCurrentUser()
        } catch {
            self.error = "Google Sign-In not configured. Use Dev Login for testing."
        }

        isLoading = false
    }

    // Development-only sign in (no Apple Sign-In required)
    func devSignIn(email: String, name: String?) async {
        isLoading = true
        error = nil

        do {
            let response = try await authService.devSignIn(email: email, name: name)

            keychainService.saveAccessToken(response.accessToken)
            keychainService.saveRefreshToken(response.refreshToken)

            isAuthenticated = true
            await fetchCurrentUser()
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func fetchCurrentUser() async {
        do {
            user = try await authService.getCurrentUser()
        } catch {
            // Token might be expired, try to refresh
            if await refreshToken() {
                user = try? await authService.getCurrentUser()
            }
        }
    }

    func refreshToken() async -> Bool {
        guard let refreshToken = keychainService.getRefreshToken() else {
            signOut()
            return false
        }

        do {
            let newAccessToken = try await authService.refreshAccessToken(refreshToken: refreshToken)
            keychainService.saveAccessToken(newAccessToken)
            return true
        } catch {
            signOut()
            return false
        }
    }

    func signOut() {
        keychainService.clearTokens()
        user = nil
        isAuthenticated = false
    }

    func deleteAccount() async {
        do {
            try await authService.deleteAccount()
            signOut()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
