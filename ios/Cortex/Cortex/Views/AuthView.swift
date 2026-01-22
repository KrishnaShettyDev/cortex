import SwiftUI
import AuthenticationServices

struct AuthView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        ZStack {
            // Background
            Color.bgPrimary
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Logo
                GradientIcon(size: 120)
                    .padding(.bottom, 32)

                // Title
                HStack(spacing: 8) {
                    Text("Meet")
                        .font(.system(size: 36, weight: .light))
                        .foregroundColor(.textPrimary)
                    Text("Cortex")
                        .font(.system(size: 36, weight: .semibold))
                        .foregroundStyle(Color.accentGradient)
                }

                // Subtitle
                Text("Your second brain.")
                    .font(.system(size: 17, weight: .regular))
                    .foregroundColor(.textSecondary)
                    .padding(.top, 8)

                Spacer()

                // Auth buttons
                VStack(spacing: 16) {
                    // Continue with Google
                    Button(action: {
                        Task {
                            await appState.signInWithGoogle()
                        }
                    }) {
                        HStack(spacing: 12) {
                            Image(systemName: "g.circle.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.textPrimary)
                            Text("Continue with Google")
                                .font(.system(size: 17, weight: .medium))
                                .foregroundColor(.textPrimary)
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.horizontal, 32)

                    // Continue with Apple
                    SignInWithAppleButton(
                        onRequest: { request in
                            request.requestedScopes = [.email, .fullName]
                        },
                        onCompletion: { result in
                            handleSignIn(result: result)
                        }
                    )
                    .signInWithAppleButtonStyle(.white)
                    .frame(height: 54)
                    .cornerRadius(16)
                    .padding(.horizontal, 32)
                }

                // Dev Login (Debug only)
                #if DEBUG
                Button(action: {
                    Task {
                        await appState.devSignIn(
                            email: "krishnashetty.strive@gmail.com",
                            name: "Krishna Shetty"
                        )
                    }
                }) {
                    Text("Dev Login")
                        .font(.system(size: 14))
                        .foregroundColor(.textTertiary)
                }
                .padding(.top, 16)
                #endif

                if appState.isLoading {
                    ProgressView()
                        .tint(.accent)
                        .padding(.top, 20)
                }

                if let error = appState.error {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.error)
                        .padding(.top, 12)
                        .padding(.horizontal, 32)
                }

                Spacer()
                    .frame(height: 40)

                // Terms
                Text("By continuing, you agree to our Terms of Service")
                    .font(.system(size: 12))
                    .foregroundColor(.textTertiary)
                    .padding(.bottom, 24)
            }
        }
        .preferredColorScheme(.dark)
    }

    private func handleSignIn(result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            guard let appleIDCredential = auth.credential as? ASAuthorizationAppleIDCredential,
                  let identityTokenData = appleIDCredential.identityToken,
                  let identityToken = String(data: identityTokenData, encoding: .utf8),
                  let authCodeData = appleIDCredential.authorizationCode,
                  let authCode = String(data: authCodeData, encoding: .utf8) else {
                return
            }

            let name = [
                appleIDCredential.fullName?.givenName,
                appleIDCredential.fullName?.familyName
            ].compactMap { $0 }.joined(separator: " ")

            Task {
                await appState.signInWithApple(
                    identityToken: identityToken,
                    authorizationCode: authCode,
                    name: name.isEmpty ? nil : name,
                    email: appleIDCredential.email
                )
            }

        case .failure(let error):
            print("Sign in failed: \(error.localizedDescription)")
        }
    }
}

#Preview {
    AuthView()
        .environmentObject(AppState())
}
