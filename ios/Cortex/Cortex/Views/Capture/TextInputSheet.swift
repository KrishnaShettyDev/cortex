import SwiftUI

struct TextInputSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var isLoading = false
    @State private var error: String?
    @FocusState private var isFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                TextEditor(text: $text)
                    .font(.bodyLarge)
                    .focused($isFocused)
                    .frame(maxHeight: .infinity)
                    .padding()
                    .background(Color.bgSecondary)
                    .cornerRadius(16)
                    .padding()

                if let error = error {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.error)
                        .padding(.horizontal)
                }

                Button(action: saveMemory) {
                    if isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Text("Save Memory")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(text.isEmpty || isLoading)
                .padding()
            }
            .background(Color.bgPrimary)
            .navigationTitle("Quick Note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                isFocused = true
            }
        }
    }

    private func saveMemory() {
        isLoading = true
        error = nil

        Task {
            do {
                _ = try await MemoryService.shared.createMemory(
                    content: text,
                    type: .text,
                    date: Date()
                )

                await MainActor.run {
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

#Preview {
    TextInputSheet()
}
