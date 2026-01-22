import Foundation
import Speech
import AVFoundation

@MainActor
class SpeechService: ObservableObject {
    @Published var isRecording = false
    @Published var transcribedText = ""
    @Published var error: String?
    @Published var isAuthorized = false

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))

    init() {
        Task {
            await checkAuthorization()
        }
    }

    // MARK: - Authorization
    func checkAuthorization() async {
        // Check speech recognition authorization
        let speechStatus = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }

        // Check microphone authorization
        let audioStatus = await AVAudioApplication.requestRecordPermission()

        await MainActor.run {
            isAuthorized = speechStatus == .authorized && audioStatus
        }
    }

    // MARK: - Start Recording
    func startRecording() {
        guard isAuthorized else {
            error = "Speech recognition not authorized"
            return
        }

        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            error = "Speech recognition not available"
            return
        }

        // Reset state
        transcribedText = ""
        error = nil

        do {
            // Configure audio session
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            // Create audio engine and request
            audioEngine = AVAudioEngine()
            recognitionRequest = SFSpeechAudioBufferRecognitionRequest()

            guard let audioEngine = audioEngine,
                  let recognitionRequest = recognitionRequest else {
                error = "Failed to create audio components"
                return
            }

            recognitionRequest.shouldReportPartialResults = true

            // Configure input node
            let inputNode = audioEngine.inputNode
            let recordingFormat = inputNode.outputFormat(forBus: 0)

            inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
                self.recognitionRequest?.append(buffer)
            }

            // Start recognition task
            recognitionTask = recognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
                Task { @MainActor in
                    if let result = result {
                        self?.transcribedText = result.bestTranscription.formattedString
                    }

                    if let error = error {
                        self?.error = error.localizedDescription
                        self?.stopRecording()
                    }
                }
            }

            // Start audio engine
            audioEngine.prepare()
            try audioEngine.start()

            isRecording = true
        } catch {
            self.error = "Failed to start recording: \(error.localizedDescription)"
            stopRecording()
        }
    }

    // MARK: - Stop Recording
    func stopRecording() {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        audioEngine = nil
        recognitionRequest = nil
        recognitionTask = nil

        isRecording = false

        // Reset audio session
        try? AVAudioSession.sharedInstance().setActive(false)
    }
}
