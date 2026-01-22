import SwiftUI

struct ChatView: View {
    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    @State private var isLoading = false
    @State private var conversationId: String?
    @FocusState private var isInputFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Messages
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            if messages.isEmpty {
                                ChatEmptyView()
                            } else {
                                ForEach(messages) { message in
                                    MessageBubble(message: message)
                                        .id(message.id)
                                }

                                if isLoading {
                                    TypingIndicator()
                                        .id("typing")
                                }
                            }
                        }
                        .padding()
                    }
                    .onChange(of: messages.count) { _, _ in
                        withAnimation {
                            if let lastId = messages.last?.id {
                                proxy.scrollTo(lastId, anchor: .bottom)
                            }
                        }
                    }
                    .onChange(of: isLoading) { _, newValue in
                        if newValue {
                            withAnimation {
                                proxy.scrollTo("typing", anchor: .bottom)
                            }
                        }
                    }
                }

                // Input
                HStack(spacing: 12) {
                    TextField("Ask about your memories...", text: $inputText)
                        .textFieldStyle(CortexTextFieldStyle())
                        .focused($isInputFocused)
                        .submitLabel(.send)
                        .onSubmit {
                            sendMessage()
                        }

                    Button(action: sendMessage) {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 36))
                            .foregroundColor(inputText.isEmpty ? .textTertiary : .accent)
                    }
                    .disabled(inputText.isEmpty || isLoading)
                }
                .padding()
                .background(Color.bgSecondary)
            }
            .background(Color.bgPrimary)
            .navigationTitle("Chat")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        clearConversation()
                    } label: {
                        Image(systemName: "trash")
                            .foregroundColor(.textSecondary)
                    }
                    .disabled(messages.isEmpty)
                }
            }
        }
    }

    private func sendMessage() {
        guard !inputText.isEmpty else { return }

        let userMessage = ChatMessage(
            role: .user,
            content: inputText
        )
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
                        content: "Sorry, I couldn't process that. \(error.localizedDescription)"
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

struct ChatEmptyView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 60))
                .foregroundColor(.accent.opacity(0.5))

            Text("Chat with your memories")
                .font(.titleSmall)
                .foregroundColor(.textPrimary)

            VStack(spacing: 8) {
                SuggestedQuestion("What did I discuss with John last week?")
                SuggestedQuestion("Summarize my notes about the project")
                SuggestedQuestion("When was my last meeting about marketing?")
            }
        }
        .padding(.top, 60)
    }
}

struct SuggestedQuestion: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.bodyMedium)
            .foregroundColor(.textSecondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.bgSecondary)
            .cornerRadius(20)
    }
}

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .user {
                Spacer(minLength: 60)
            }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
                Text(message.content)
                    .font(.bodyLarge)
                    .foregroundColor(message.role == .user ? .white : .textPrimary)
                    .padding()
                    .background(message.role == .user ? Color.accent : Color.white)
                    .cornerRadius(20)
                    .shadow(color: .black.opacity(0.05), radius: 5)

                // Memory references
                if let memories = message.memoriesUsed, !memories.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Based on \(memories.count) memories")
                            .font(.caption)
                            .foregroundColor(.textTertiary)

                        ForEach(memories.prefix(3)) { memory in
                            SourceMemoryChip(memory: memory)
                        }
                    }
                }
            }

            if message.role == .assistant {
                Spacer(minLength: 60)
            }
        }
    }
}

struct SourceMemoryChip: View {
    let memory: MemoryReference

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: iconForType(memory.memoryType))
                .font(.caption2)
                .foregroundColor(.accent)

            Text(memory.content.prefix(50) + "...")
                .font(.caption)
                .foregroundColor(.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.accent.opacity(0.1))
        .cornerRadius(12)
    }

    private func iconForType(_ type: String) -> String {
        switch type {
        case "voice": return "mic.fill"
        case "text": return "text.bubble.fill"
        case "photo": return "photo.fill"
        case "email": return "envelope.fill"
        case "calendar": return "calendar"
        default: return "doc.fill"
        }
    }
}

struct TypingIndicator: View {
    @State private var animationPhase = 0

    var body: some View {
        HStack {
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(Color.textTertiary)
                        .frame(width: 8, height: 8)
                        .scaleEffect(animationPhase == i ? 1.2 : 1.0)
                }
            }
            .padding()
            .background(Color.white)
            .cornerRadius(20)

            Spacer()
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.4).repeatForever()) {
                animationPhase = (animationPhase + 1) % 3
            }
        }
    }
}

#Preview {
    ChatView()
}
