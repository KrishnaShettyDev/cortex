import SwiftUI

struct IntegrationsView: View {
    @State private var googleStatus: IntegrationStatus?
    @State private var isLoading = false
    @State private var isSyncing = false
    @State private var error: String?
    @State private var syncResult: String?

    var body: some View {
        List {
            Section {
                HStack {
                    // Google icon
                    Image(systemName: "envelope.fill")
                        .foregroundColor(.emailMemory)
                        .frame(width: 32, height: 32)
                        .background(Color.emailMemory.opacity(0.1))
                        .cornerRadius(8)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Google")
                            .font(.titleSmall)

                        if let status = googleStatus {
                            if status.connected {
                                if let lastSync = status.lastSync {
                                    Text("Last synced \(formatDate(lastSync))")
                                        .font(.caption)
                                        .foregroundColor(.textSecondary)
                                } else {
                                    Text("Connected")
                                        .font(.caption)
                                        .foregroundColor(.success)
                                }
                            } else {
                                Text("Not connected")
                                    .font(.caption)
                                    .foregroundColor(.textSecondary)
                            }
                        }
                    }

                    Spacer()

                    if googleStatus?.connected == true {
                        Menu {
                            Button("Sync Now") {
                                syncGoogle()
                            }
                            Button("Disconnect", role: .destructive) {
                                disconnectGoogle()
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                                .foregroundColor(.textSecondary)
                        }
                    } else {
                        Button("Connect") {
                            connectGoogle()
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                }
                .padding(.vertical, 4)
            } header: {
                Text("Email & Calendar")
            } footer: {
                Text("Connect your Google account to automatically sync emails and calendar events as memories.")
            }

            if isSyncing {
                Section {
                    HStack {
                        ProgressView()
                        Text("Syncing...")
                            .foregroundColor(.textSecondary)
                    }
                }
            }

            if let result = syncResult {
                Section {
                    Text(result)
                        .foregroundColor(.success)
                }
            }

            if let error = error {
                Section {
                    Text(error)
                        .foregroundColor(.error)
                }
            }
        }
        .navigationTitle("Integrations")
        .onAppear {
            loadStatus()
        }
    }

    private func loadStatus() {
        isLoading = true

        Task {
            do {
                let status: IntegrationsStatusResponse = try await APIService.shared.request(
                    endpoint: "/integrations/status"
                )

                await MainActor.run {
                    googleStatus = status.google
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }

    private func connectGoogle() {
        Task {
            do {
                struct RedirectResponse: Codable {
                    let redirectUrl: String

                    enum CodingKeys: String, CodingKey {
                        case redirectUrl = "redirect_url"
                    }
                }

                let response: RedirectResponse = try await APIService.shared.request(
                    endpoint: "/integrations/google/connect"
                )

                // Open OAuth URL in browser
                if let url = URL(string: response.redirectUrl) {
                    await MainActor.run {
                        UIApplication.shared.open(url)
                    }
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                }
            }
        }
    }

    private func disconnectGoogle() {
        Task {
            do {
                struct Response: Codable {
                    let success: Bool
                }

                let _: Response = try await APIService.shared.request(
                    endpoint: "/integrations/google",
                    method: "DELETE"
                )

                await MainActor.run {
                    googleStatus = IntegrationStatus(connected: false, lastSync: nil)
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                }
            }
        }
    }

    private func syncGoogle() {
        isSyncing = true
        error = nil
        syncResult = nil

        Task {
            do {
                struct SyncRequest: Codable {
                    let provider: String
                }

                let response: SyncResponse = try await APIService.shared.request(
                    endpoint: "/integrations/sync",
                    method: "POST",
                    body: SyncRequest(provider: "google")
                )

                await MainActor.run {
                    isSyncing = false
                    syncResult = "Synced \(response.memoriesAdded) new memories"
                    loadStatus()
                }
            } catch {
                await MainActor.run {
                    isSyncing = false
                    self.error = error.localizedDescription
                }
            }
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

#Preview {
    NavigationStack {
        IntegrationsView()
    }
}
