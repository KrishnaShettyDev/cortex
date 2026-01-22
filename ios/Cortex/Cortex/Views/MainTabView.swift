import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        MainChatView()
            .environmentObject(appState)
            .preferredColorScheme(.dark)
    }
}

// MARK: - Main Chat View (Iris-style)
struct MainChatView: View {
    @EnvironmentObject var appState: AppState
    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    @State private var isLoading = false
    @State private var conversationId: String?
    @State private var showSettings = false
    @State private var showAddMemory = false
    @FocusState private var isInputFocused: Bool

    var body: some View {
        ZStack {
            // Background
            Color.bgPrimary
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerView

                // Messages
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            if messages.isEmpty {
                                emptyStateView
                            } else {
                                ForEach(messages) { message in
                                    ChatBubble(message: message)
                                        .id(message.id)
                                }

                                if isLoading {
                                    LoadingBubble()
                                        .id("loading")
                                }
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 20)
                        .padding(.bottom, 100)
                    }
                    .onChange(of: messages.count) { _, _ in
                        withAnimation(.spring(duration: 0.3)) {
                            if let lastId = messages.last?.id {
                                proxy.scrollTo(lastId, anchor: .bottom)
                            }
                        }
                    }
                    .onChange(of: isLoading) { _, newValue in
                        if newValue {
                            withAnimation(.spring(duration: 0.3)) {
                                proxy.scrollTo("loading", anchor: .bottom)
                            }
                        }
                    }
                }

                // Input bar
                inputBarView
            }

            // Floating add button
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    FloatingActionButton(icon: "plus") {
                        showAddMemory = true
                    }
                    .padding(.trailing, 20)
                    .padding(.bottom, 100)
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsSheet()
                .environmentObject(appState)
        }
        .sheet(isPresented: $showAddMemory) {
            AddMemorySheet()
        }
    }

    // MARK: - Header
    private var headerView: some View {
        HStack {
            Button(action: { showSettings = true }) {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(.textPrimary)
            }

            Spacer()

            // Logo
            GradientIcon(size: 32)

            Spacer()

            Button(action: { clearConversation() }) {
                Text("Clear")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.textSecondary)
            }
            .opacity(messages.isEmpty ? 0.3 : 1)
            .disabled(messages.isEmpty)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    // MARK: - Empty State
    private var emptyStateView: some View {
        VStack(spacing: 24) {
            Spacer()
                .frame(height: 60)

            Text("Just now")
                .font(.system(size: 13))
                .foregroundColor(.textTertiary)

            Text("Good \(greeting) \(userName), how can I help you today?")
                .font(.system(size: 20, weight: .medium))
                .foregroundColor(.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)

            // Suggested questions
            VStack(spacing: 12) {
                SuggestionPill(text: "What did I discuss last week?", action: { sendSuggestion("What did I discuss last week?") })
                SuggestionPill(text: "Summarize my recent notes", action: { sendSuggestion("Summarize my recent notes") })
                SuggestionPill(text: "Find my meeting notes", action: { sendSuggestion("Find my meeting notes") })
            }
            .padding(.top, 20)

            Spacer()
        }
    }

    // MARK: - Input Bar
    private var inputBarView: some View {
        HStack(spacing: 12) {
            TextField("Ask Cortex...", text: $inputText)
                .textFieldStyle(ChatInputStyle())
                .focused($isInputFocused)
                .submitLabel(.send)
                .onSubmit { sendMessage() }

            Button(action: sendMessage) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 18))
                    .foregroundColor(.bgPrimary)
                    .frame(width: 44, height: 44)
                    .background(
                        Circle()
                            .fill(Color.accent)
                    )
            }
            .disabled(isLoading)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(Color.bgSecondary)
    }

    // MARK: - Helpers
    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "morning" }
        if hour < 17 { return "afternoon" }
        return "evening"
    }

    private var userName: String {
        appState.user?.name?.components(separatedBy: " ").first ?? "there"
    }

    private func sendSuggestion(_ text: String) {
        inputText = text
        sendMessage()
    }

    private func sendMessage() {
        guard !inputText.isEmpty else { return }

        let userMessage = ChatMessage(role: .user, content: inputText)
        messages.append(userMessage)

        let query = inputText
        inputText = ""
        isLoading = true

        Task {
            do {
                let response = try await ChatService.shared.chat(
                    message: query,
                    conversationId: conversationId
                )

                await MainActor.run {
                    let assistantMessage = ChatMessage(
                        role: .assistant,
                        content: response.response,
                        memoriesUsed: response.memoriesUsed
                    )
                    messages.append(assistantMessage)
                    conversationId = response.conversationId
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    let errorMessage = ChatMessage(
                        role: .assistant,
                        content: "I couldn't process that. \(error.localizedDescription)"
                    )
                    messages.append(errorMessage)
                    isLoading = false
                }
            }
        }
    }

    private func clearConversation() {
        messages = []
        conversationId = nil
    }
}

// MARK: - Chat Bubble
struct ChatBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
                Text(message.content)
                    .font(.system(size: 16))
                    .foregroundColor(message.role == .user ? .bgPrimary : .textPrimary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(message.role == .user ? Color.accent : Color.bgTertiary)
                    )

                // Memory references
                if let memories = message.memoriesUsed, !memories.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "brain")
                            .font(.system(size: 11))
                        Text("Based on \(memories.count) memories")
                            .font(.system(size: 12))
                    }
                    .foregroundColor(.textTertiary)
                }
            }

            if message.role == .assistant { Spacer(minLength: 60) }
        }
    }
}

// MARK: - Loading Bubble
struct LoadingBubble: View {
    @State private var dotIndex = 0

    var body: some View {
        HStack {
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(Color.textTertiary)
                        .frame(width: 8, height: 8)
                        .opacity(dotIndex == i ? 1 : 0.3)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color.bgTertiary)
            )

            Spacer()
        }
        .onAppear {
            Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { _ in
                dotIndex = (dotIndex + 1) % 3
            }
        }
    }
}

// MARK: - Suggestion Pill
struct SuggestionPill: View {
    let text: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Circle()
                    .fill(Color.glassBorder)
                    .frame(width: 8, height: 8)
                Text(text)
                    .font(.system(size: 15))
                    .foregroundColor(.textSecondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .glassCard(cornerRadius: 24)
        }
    }
}

// MARK: - Settings Sheet
struct SettingsSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgPrimary.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Profile header
                    VStack(spacing: 12) {
                        Circle()
                            .fill(Color.bgTertiary)
                            .frame(width: 80, height: 80)
                            .overlay(
                                Text(appState.user?.name?.prefix(1).uppercased() ?? "?")
                                    .font(.system(size: 32, weight: .medium))
                                    .foregroundColor(.textPrimary)
                            )

                        Text(appState.user?.name ?? "User")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(.textPrimary)

                        Text(appState.user?.email ?? "")
                            .font(.system(size: 14))
                            .foregroundColor(.textSecondary)
                    }
                    .padding(.top, 40)
                    .padding(.bottom, 32)

                    Divider()
                        .background(Color.glassBorder)

                    // Menu items
                    VStack(spacing: 0) {
                        SettingsRow(icon: "bell", title: "Notifications")
                        SettingsRow(icon: "link", title: "Connected Accounts")
                        SettingsRow(icon: "questionmark.circle", title: "Help & Support")
                    }
                    .padding(.top, 16)

                    Spacer()

                    // Sign out
                    Button(action: {
                        appState.signOut()
                        dismiss()
                    }) {
                        HStack {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                            Text("Sign Out")
                        }
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.error)
                    }
                    .padding(.bottom, 40)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct SettingsRow: View {
    let icon: String
    let title: String

    var body: some View {
        Button(action: {}) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundColor(.textSecondary)
                    .frame(width: 32)

                Text(title)
                    .font(.system(size: 16))
                    .foregroundColor(.textPrimary)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14))
                    .foregroundColor(.textTertiary)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
    }
}

// MARK: - Add Memory Sheet
struct AddMemorySheet: View {
    @Environment(\.dismiss) var dismiss
    @State private var memoryText = ""
    @State private var isRecording = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgPrimary.ignoresSafeArea()

                VStack(spacing: 32) {
                    // Big record button
                    Button(action: { isRecording.toggle() }) {
                        ZStack {
                            Circle()
                                .fill(isRecording ? Color.error : Color.accent)
                                .frame(width: 100, height: 100)

                            Image(systemName: isRecording ? "stop.fill" : "mic.fill")
                                .font(.system(size: 36))
                                .foregroundColor(.bgPrimary)
                        }
                    }
                    .padding(.top, 60)

                    Text(isRecording ? "Recording..." : "Tap to record")
                        .font(.system(size: 17))
                        .foregroundColor(.textSecondary)

                    // Or text input
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Or type a note")
                            .font(.system(size: 14))
                            .foregroundColor(.textTertiary)

                        TextField("What's on your mind?", text: $memoryText, axis: .vertical)
                            .textFieldStyle(CortexTextFieldStyle())
                            .lineLimit(3...6)
                    }
                    .padding(.horizontal, 20)

                    Spacer()

                    // Save button
                    Button(action: { dismiss() }) {
                        Text("Save Memory")
                            .font(.system(size: 17, weight: .semibold))
                    }
                    .buttonStyle(AccentButtonStyle())
                    .padding(.horizontal, 20)
                    .padding(.bottom, 40)
                    .disabled(memoryText.isEmpty && !isRecording)
                    .opacity(memoryText.isEmpty && !isRecording ? 0.5 : 1)
                }
            }
            .navigationTitle("Add Memory")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.textSecondary)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

#Preview {
    MainTabView()
        .environmentObject(AppState())
}
