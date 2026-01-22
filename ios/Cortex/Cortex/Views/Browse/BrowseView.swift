import SwiftUI

struct BrowseView: View {
    @State private var memories: [Memory] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var selectedType: MemoryType?
    @State private var showFilter = false
    @State private var offset = 0
    @State private var hasMore = true

    private let limit = 20

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgPrimary.ignoresSafeArea()

                if isLoading && memories.isEmpty {
                    ProgressView()
                } else if let error = error, memories.isEmpty {
                    ErrorView(message: error) {
                        loadMemories()
                    }
                } else if memories.isEmpty {
                    EmptyBrowseView()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            ForEach(memories) { memory in
                                MemoryCard(memory: memory)
                                    .onAppear {
                                        if memory.id == memories.last?.id && hasMore {
                                            loadMoreMemories()
                                        }
                                    }
                            }

                            if isLoading && !memories.isEmpty {
                                ProgressView()
                                    .padding()
                            }
                        }
                        .padding()
                    }
                    .refreshable {
                        await refreshMemories()
                    }
                }
            }
            .navigationTitle("Browse")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showFilter = true
                    } label: {
                        Image(systemName: selectedType == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                            .foregroundColor(.accent)
                    }
                }
            }
            .sheet(isPresented: $showFilter) {
                FilterSheet(selectedType: $selectedType) {
                    resetAndLoad()
                }
            }
            .onAppear {
                if memories.isEmpty {
                    loadMemories()
                }
            }
        }
    }

    private func loadMemories() {
        isLoading = true
        error = nil

        Task {
            do {
                let response = try await MemoryService.shared.listMemories(
                    limit: limit,
                    offset: offset,
                    type: selectedType
                )

                await MainActor.run {
                    memories = response.memories
                    hasMore = response.memories.count == limit
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

    private func loadMoreMemories() {
        guard !isLoading && hasMore else { return }

        isLoading = true
        offset += limit

        Task {
            do {
                let response = try await MemoryService.shared.listMemories(
                    limit: limit,
                    offset: offset,
                    type: selectedType
                )

                await MainActor.run {
                    memories.append(contentsOf: response.memories)
                    hasMore = response.memories.count == limit
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                }
            }
        }
    }

    private func refreshMemories() async {
        offset = 0

        do {
            let response = try await MemoryService.shared.listMemories(
                limit: limit,
                offset: 0,
                type: selectedType
            )

            await MainActor.run {
                memories = response.memories
                hasMore = response.memories.count == limit
            }
        } catch {
            // Silent fail on refresh
        }
    }

    private func resetAndLoad() {
        memories = []
        offset = 0
        hasMore = true
        loadMemories()
    }
}

struct EmptyBrowseView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "tray")
                .font(.system(size: 48))
                .foregroundColor(.textTertiary)

            Text("No memories yet")
                .font(.titleSmall)
                .foregroundColor(.textPrimary)

            Text("Start capturing your thoughts")
                .font(.bodyMedium)
                .foregroundColor(.textSecondary)
        }
    }
}

struct ErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(.error)

            Text("Something went wrong")
                .font(.titleSmall)
                .foregroundColor(.textPrimary)

            Text(message)
                .font(.bodyMedium)
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)

            Button("Retry", action: retry)
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding()
    }
}

struct FilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var selectedType: MemoryType?
    let onApply: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section("Memory Type") {
                    Button {
                        selectedType = nil
                    } label: {
                        HStack {
                            Text("All Types")
                            Spacer()
                            if selectedType == nil {
                                Image(systemName: "checkmark")
                                    .foregroundColor(.accent)
                            }
                        }
                    }
                    .foregroundColor(.textPrimary)

                    ForEach(MemoryType.allCases, id: \.self) { type in
                        Button {
                            selectedType = type
                        } label: {
                            HStack {
                                Image(systemName: type.icon)
                                    .foregroundColor(Color.memoryColor(for: type.rawValue))
                                    .frame(width: 24)
                                Text(type.displayName)
                                Spacer()
                                if selectedType == type {
                                    Image(systemName: "checkmark")
                                        .foregroundColor(.accent)
                                }
                            }
                        }
                        .foregroundColor(.textPrimary)
                    }
                }
            }
            .navigationTitle("Filter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        onApply()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

#Preview {
    BrowseView()
}
