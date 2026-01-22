import Foundation
import AuthenticationServices

class AuthService {
    static let shared = AuthService()
    private let api = APIService.shared

    private init() {}

    // MARK: - Apple Sign-In Response
    struct AppleAuthResponse: Codable {
        let userId: UUID
        let accessToken: String
        let refreshToken: String
        let isNewUser: Bool

        enum CodingKeys: String, CodingKey {
            case userId = "user_id"
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
            case isNewUser = "is_new_user"
        }
    }

    // MARK: - Sign In
    func signInWithApple(
        identityToken: String,
        authorizationCode: String,
        name: String?,
        email: String?
    ) async throws -> AppleAuthResponse {
        struct Request: Codable {
            let identityToken: String
            let authorizationCode: String
            let name: String?
            let email: String?

            enum CodingKeys: String, CodingKey {
                case identityToken = "identity_token"
                case authorizationCode = "authorization_code"
                case name
                case email
            }
        }

        let request = Request(
            identityToken: identityToken,
            authorizationCode: authorizationCode,
            name: name,
            email: email
        )

        return try await api.request(
            endpoint: "/auth/apple",
            method: "POST",
            body: request,
            requiresAuth: false
        )
    }

    // MARK: - Google Sign-In
    func signInWithGoogle(idToken: String, name: String?, email: String?) async throws -> AppleAuthResponse {
        struct Request: Codable {
            let idToken: String
            let name: String?
            let email: String?

            enum CodingKeys: String, CodingKey {
                case idToken = "id_token"
                case name
                case email
            }
        }

        let request = Request(idToken: idToken, name: name, email: email)

        return try await api.request(
            endpoint: "/auth/google",
            method: "POST",
            body: request,
            requiresAuth: false
        )
    }

    // MARK: - Dev Sign-In (Development Only)
    func devSignIn(email: String, name: String?) async throws -> AppleAuthResponse {
        struct Request: Codable {
            let email: String
            let name: String?
        }

        let request = Request(email: email, name: name)

        return try await api.request(
            endpoint: "/auth/dev",
            method: "POST",
            body: request,
            requiresAuth: false
        )
    }

    // MARK: - Refresh Token
    func refreshAccessToken(refreshToken: String) async throws -> String {
        struct Request: Codable {
            let refreshToken: String

            enum CodingKeys: String, CodingKey {
                case refreshToken = "refresh_token"
            }
        }

        struct Response: Codable {
            let accessToken: String

            enum CodingKeys: String, CodingKey {
                case accessToken = "access_token"
            }
        }

        let request = Request(refreshToken: refreshToken)
        let response: Response = try await api.request(
            endpoint: "/auth/refresh",
            method: "POST",
            body: request,
            requiresAuth: false
        )

        return response.accessToken
    }

    // MARK: - Get Current User
    func getCurrentUser() async throws -> User {
        return try await api.request(endpoint: "/auth/me")
    }

    // MARK: - Delete Account
    func deleteAccount() async throws {
        struct Response: Codable {
            let success: Bool
        }

        let _: Response = try await api.request(
            endpoint: "/auth/account",
            method: "DELETE"
        )
    }
}
