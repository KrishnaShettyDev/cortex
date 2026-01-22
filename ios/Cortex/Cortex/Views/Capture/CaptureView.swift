import SwiftUI

struct CaptureView: View {
    @StateObject private var speechService = SpeechService()
    @StateObject private var audioRecorder = AudioRecorder()
    @State private var showTextInput = false
    @State private var showPhotoCapture = false
    @State private var isProcessing = false
    @State private var showSuccess = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgPrimary.ignoresSafeArea()

                VStack(spacing: 32) {
                    Spacer()

                    // Recording status
                    if speechService.isRecording {
                        VStack(spacing: 16) {
                            // Waveform animation placeholder
                            HStack(spacing: 4) {
                                ForEach(0..<5) { i in
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(Color.accent)
                                        .frame(width: 4, height: CGFloat.random(in: 20...60))
                                        .animation(
                                            .easeInOut(duration: 0.3).repeatForever(),
                                            value: speechService.isRecording
                                        )
                                }
                            }
                            .frame(height: 60)

                            Text(AudioRecorder.formatDuration(audioRecorder.duration))
                                .font(.titleMedium)
                                .foregroundColor(.textPrimary)
                                .monospacedDigit()
                        }
                    }

                    // Big record button
                    VoiceRecordButton(
                        isRecording: speechService.isRecording,
                        onTap: {
                            if speechService.isRecording {
                                stopRecording()
                            } else {
                                startRecording()
                            }
                        }
                    )

                    // Status text
                    Text(statusText)
                        .font(.bodyMedium)
                        .foregroundColor(.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    // Transcription preview
                    if !speechService.transcribedText.isEmpty {
                        Text(speechService.transcribedText)
                            .font(.bodyLarge)
                            .foregroundColor(.textPrimary)
                            .padding()
                            .frame(maxWidth: .infinity)
                            .glassCard()
                            .padding(.horizontal)
                    }

                    Spacer()

                    // Quick actions
                    HStack(spacing: 32) {
                        QuickActionButton(
                            icon: "text.bubble",
                            label: "Text"
                        ) {
                            showTextInput = true
                        }

                        QuickActionButton(
                            icon: "camera",
                            label: "Photo"
                        ) {
                            showPhotoCapture = true
                        }
                    }
                    .padding(.bottom, 40)
                }
            }
            .navigationTitle("Cortex")
            .sheet(isPresented: $showTextInput) {
                TextInputSheet()
            }
            .sheet(isPresented: $showPhotoCapture) {
                PhotoCaptureSheet()
            }
            .overlay {
                if showSuccess {
                    SuccessOverlay()
                        .transition(.scale.combined(with: .opacity))
                }
            }
        }
    }

    private var statusText: String {
        if isProcessing {
            return "Saving memory..."
        } else if speechService.isRecording {
            return "Listening..."
        } else if !speechService.isAuthorized {
            return "Tap to enable speech recognition"
        } else {
            return "Tap to capture a thought"
        }
    }

    private func startRecording() {
        speechService.startRecording()
        audioRecorder.startRecording()
    }

    private func stopRecording() {
        speechService.stopRecording()
        _ = audioRecorder.stopRecording()

        guard !speechService.transcribedText.isEmpty else { return }

        isProcessing = true

        Task {
            do {
                // Upload audio if available
                var audioUrl: String? = nil
                if let audioData = audioRecorder.getRecordingData() {
                    audioUrl = try await MemoryService.shared.uploadAudio(data: audioData)
                }

                // Create memory
                _ = try await MemoryService.shared.createMemory(
                    content: speechService.transcribedText,
                    type: .voice,
                    date: Date(),
                    audioUrl: audioUrl
                )

                await MainActor.run {
                    isProcessing = false
                    showSuccess = true
                    speechService.transcribedText = ""

                    // Hide success after delay
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        withAnimation {
                            showSuccess = false
                        }
                    }
                }
            } catch {
                await MainActor.run {
                    isProcessing = false
                    speechService.error = error.localizedDescription
                }
            }
        }
    }
}

struct VoiceRecordButton: View {
    let isRecording: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            ZStack {
                Circle()
                    .fill(isRecording ? Color.error : Color.accent)
                    .frame(width: 100, height: 100)
                    .shadow(color: (isRecording ? Color.error : Color.accent).opacity(0.3), radius: 20)

                if isRecording {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.white)
                        .frame(width: 32, height: 32)
                } else {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 36))
                        .foregroundColor(.white)
                }
            }
        }
        .scaleEffect(isRecording ? 1.1 : 1.0)
        .animation(.easeInOut(duration: 0.2), value: isRecording)
    }
}

struct QuickActionButton: View {
    let icon: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundColor(.accent)
                    .frame(width: 56, height: 56)
                    .background(Color.accent.opacity(0.1))
                    .cornerRadius(16)

                Text(label)
                    .font(.caption)
                    .foregroundColor(.textSecondary)
            }
        }
    }
}

struct SuccessOverlay: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 60))
                .foregroundColor(.success)

            Text("Memory Saved")
                .font(.titleSmall)
                .foregroundColor(.textPrimary)
        }
        .padding(32)
        .glassCard()
    }
}

#Preview {
    CaptureView()
}
