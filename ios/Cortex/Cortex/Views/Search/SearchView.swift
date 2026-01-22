import SwiftUI

struct SearchView: View {
    @State private var searchText = ""
    @State private var memories: [Memory] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var hasSearched = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgPrimary.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Search bar
                    HStack(spacing: 12) {
                        Image(systemName: "magnifyingglass")
                            .foregroundColor(.textSecondary)

                        TextField("Search your memories...", text: $searchText)
                            .font(.bodyLarge)
                            .submitLabel(.search)
                            .onSubmit {
                                performSearch()
                            }

                        if !searchText.isEmpty {
                            Button {
                                searchText = ""
                                memories = []
                                hasSearched = false
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundColor(.textTertiary)
                            }
                        }
                    }
                    .padding()
                    .background(Color.bgSecondary)
                    .cornerRadius(16)
                    .padding()

                    // Results
                    if isLoading {
                        Spacer()
                        ProgressView()
                        Spacer()
                    } else if let error = error {
                        Spacer()
                        VStack(spacing: 12) {
                            Image(systemName: "exclamationmark.triangle")
                                .font(.largeTitle)
                                .foregroundColor(.error)
                            Text(error)
                                .font(.bodyMedium)
                                .foregroundColor(.textSecondary)
                        }
                        Spacer()
                    } else if memories.isEmpty && hasSearched {
                        Spacer()
                        EmptySearchView(query: searchText)
                        Spacer()
                    } else if memories.isEmpty {
                        Spacer()
                        SearchPromptView()
                        Spacer()
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 16) {
                                ForEach(memories) { memory in
                                    MemoryCard(memory: memory)
                                }
                            }
                            .padding()
                        }
                    }
                }
            }
            .navigationTitle("Search")
        }
    }

    private func performSearch() {
        guard !searchText.isEmpty else { return }

        isLoading = true
        error = nil
        hasSearched = true

        Task {
            do {
                let response = try await MemoryService.shared.searchMemories(query: searchText)
                await MainActor.run {
                    memories = response.memories
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
}

struct SearchPromptView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 48))
                .foregroundColor(.textTertiary)

            Text("Search your memories")
                .font(.titleSmall)
                .foregroundColor(.textPrimary)

            Text("Find thoughts, notes, and conversations")
                .font(.bodyMedium)
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

struct EmptySearchView: View {
    let query: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 48))
                .foregroundColor(.textTertiary)

            Text("No results found")
                .font(.titleSmall)
                .foregroundColor(.textPrimary)

            Text("No memories matching \"\(query)\"")
                .font(.bodyMedium)
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

#Preview {
    SearchView()
}
