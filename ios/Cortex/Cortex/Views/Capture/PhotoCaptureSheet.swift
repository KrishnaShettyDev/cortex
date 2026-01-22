import SwiftUI
import PhotosUI

struct PhotoCaptureSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selectedItem: PhotosPickerItem?
    @State private var selectedImage: UIImage?
    @State private var context = ""
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                // Photo picker
                PhotosPicker(selection: $selectedItem, matching: .images) {
                    if let image = selectedImage {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(height: 200)
                            .clipped()
                            .cornerRadius(16)
                    } else {
                        VStack(spacing: 12) {
                            Image(systemName: "photo.on.rectangle.angled")
                                .font(.system(size: 48))
                                .foregroundColor(.textSecondary)
                            Text("Select a photo")
                                .font(.bodyMedium)
                                .foregroundColor(.textSecondary)
                        }
                        .frame(height: 200)
                        .frame(maxWidth: .infinity)
                        .background(Color.bgSecondary)
                        .cornerRadius(16)
                    }
                }
                .padding(.horizontal)

                // Context input
                VStack(alignment: .leading, spacing: 8) {
                    Text("Add context")
                        .font(.caption)
                        .foregroundColor(.textSecondary)

                    TextField("What's this about?", text: $context, axis: .vertical)
                        .textFieldStyle(CortexTextFieldStyle())
                        .lineLimit(3...6)
                }
                .padding(.horizontal)

                Spacer()

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
                .disabled(selectedImage == nil || context.isEmpty || isLoading)
                .padding()
            }
            .background(Color.bgPrimary)
            .navigationTitle("Photo Memory")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .onChange(of: selectedItem) { _, newItem in
                Task {
                    if let data = try? await newItem?.loadTransferable(type: Data.self),
                       let image = UIImage(data: data) {
                        await MainActor.run {
                            selectedImage = image
                        }
                    }
                }
            }
        }
    }

    private func saveMemory() {
        guard let image = selectedImage,
              let imageData = image.jpegData(compressionQuality: 0.8) else {
            return
        }

        isLoading = true
        error = nil

        Task {
            do {
                // Upload photo
                let photoUrl = try await MemoryService.shared.uploadPhoto(data: imageData)

                // Create memory
                _ = try await MemoryService.shared.createMemory(
                    content: context,
                    type: .photo,
                    date: Date(),
                    photoUrl: photoUrl
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
    PhotoCaptureSheet()
}
