import Foundation
import AVFoundation

@MainActor
class AudioRecorder: ObservableObject {
    @Published var isRecording = false
    @Published var recordingURL: URL?
    @Published var duration: TimeInterval = 0
    @Published var error: String?

    private var audioRecorder: AVAudioRecorder?
    private var timer: Timer?

    // MARK: - Start Recording
    func startRecording() {
        let audioSession = AVAudioSession.sharedInstance()

        do {
            try audioSession.setCategory(.playAndRecord, mode: .default)
            try audioSession.setActive(true)

            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let fileName = "recording_\(Date().timeIntervalSince1970).m4a"
            let audioURL = documentsPath.appendingPathComponent(fileName)

            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]

            audioRecorder = try AVAudioRecorder(url: audioURL, settings: settings)
            audioRecorder?.record()

            recordingURL = audioURL
            isRecording = true
            duration = 0

            // Update duration timer
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    self?.duration = self?.audioRecorder?.currentTime ?? 0
                }
            }
        } catch {
            self.error = "Failed to start recording: \(error.localizedDescription)"
        }
    }

    // MARK: - Stop Recording
    func stopRecording() -> URL? {
        timer?.invalidate()
        timer = nil

        audioRecorder?.stop()
        isRecording = false

        let url = recordingURL
        audioRecorder = nil

        return url
    }

    // MARK: - Cancel Recording
    func cancelRecording() {
        timer?.invalidate()
        timer = nil

        audioRecorder?.stop()
        isRecording = false

        // Delete the recorded file
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }

        recordingURL = nil
        audioRecorder = nil
        duration = 0
    }

    // MARK: - Get Recording Data
    func getRecordingData() -> Data? {
        guard let url = recordingURL else { return nil }
        return try? Data(contentsOf: url)
    }

    // MARK: - Format Duration
    static func formatDuration(_ duration: TimeInterval) -> String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
