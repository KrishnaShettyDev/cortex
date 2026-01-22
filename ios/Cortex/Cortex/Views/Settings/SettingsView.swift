import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @State private var showDeleteConfirmation = false

    var body: some View {
        NavigationStack {
            List {
                // Account Section
                Section("Account") {
                    if let user = appState.user {
                        HStack {
                            Image(systemName: "person.circle.fill")
                                .font(.largeTitle)
                                .foregroundColor(.accent)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(user.name ?? "Cortex User")
                                    .font(.titleSmall)
                                Text(user.email)
                                    .font(.caption)
                                    .foregroundColor(.textSecondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }

                // Integrations Section
                Section("Integrations") {
                    NavigationLink {
                        IntegrationsView()
                    } label: {
                        HStack {
                            Image(systemName: "link")
                                .foregroundColor(.accent)
                            Text("Connected Accounts")
                        }
                    }
                }

                // About Section
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundColor(.textSecondary)
                    }

                    Link(destination: URL(string: "https://cortex.app/privacy")!) {
                        HStack {
                            Text("Privacy Policy")
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.caption)
                                .foregroundColor(.textTertiary)
                        }
                    }
                    .foregroundColor(.textPrimary)

                    Link(destination: URL(string: "https://cortex.app/terms")!) {
                        HStack {
                            Text("Terms of Service")
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.caption)
                                .foregroundColor(.textTertiary)
                        }
                    }
                    .foregroundColor(.textPrimary)
                }

                // Danger Zone
                Section {
                    Button {
                        appState.signOut()
                    } label: {
                        HStack {
                            Spacer()
                            Text("Sign Out")
                                .foregroundColor(.accent)
                            Spacer()
                        }
                    }

                    Button {
                        showDeleteConfirmation = true
                    } label: {
                        HStack {
                            Spacer()
                            Text("Delete Account")
                                .foregroundColor(.error)
                            Spacer()
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .alert("Delete Account", isPresented: $showDeleteConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    Task {
                        await appState.deleteAccount()
                    }
                }
            } message: {
                Text("Are you sure you want to delete your account? This action cannot be undone and all your memories will be permanently deleted.")
            }
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(AppState())
}
