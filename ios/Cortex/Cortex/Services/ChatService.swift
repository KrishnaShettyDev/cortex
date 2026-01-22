import Foundation

class ChatService {
    static let shared = ChatService()
    private let api = APIService.shared

    private init() {}

    // MARK: - Chat (Non-streaming)
    func chat(message: String, conversationId: String? = nil) async throws -> ChatResponse {
        let request = ChatRequest(message: message, conversationId: conversationId)

        return try await api.request(
            endpoint: "/chat",
            method: "POST",
            body: request
        )
    }

    // MARK: - Chat Stream (SSE)
    func chatStream(
        message: String,
        conversationId: String? = nil,
        onContent: @escaping (String) -> Void,
        onMemories: @escaping ([MemoryReference]) -> Void,
        onDone: @escaping (String) -> Void,
        onError: @escaping (String) -> Void
    ) async {
        guard let url = URL(string: "\(Constants.apiBaseURL)/chat/stream") else {
            onError("Invalid URL")
            return
        }

        guard let token = KeychainService.shared.getAccessToken() else {
            onError("Not authenticated")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let body = ChatRequest(message: message, conversationId: conversationId)
        request.httpBody = try? JSONEncoder().encode(body)

        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                onError("Server error")
                return
            }

            for try await line in bytes.lines {
                guard line.hasPrefix("data: ") else { continue }

                let jsonString = String(line.dropFirst(6))
                guard let data = jsonString.data(using: .utf8) else { continue }

                if let chunk = try? JSONDecoder().decode(StreamChunk.self, from: data) {
                    await MainActor.run {
                        switch chunk.type {
                        case "content":
                            if let data = chunk.data, let content = data.value as? String {
                                onContent(content)
                            }
                        case "memories":
                            if let memories = chunk.memories {
                                onMemories(memories)
                            }
                        case "done":
                            if let convId = chunk.conversationId {
                                onDone(convId)
                            }
                        case "error":
                            if let error = chunk.error {
                                onError(error)
                            }
                        default:
                            break
                        }
                    }
                }
            }
        } catch {
            await MainActor.run {
                onError(error.localizedDescription)
            }
        }
    }
}

// MARK: - Stream Chunk
struct StreamChunk: Codable {
    let type: String
    let data: AnyCodable?
    let memories: [MemoryReference]?
    let conversationId: String?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case type
        case data
        case memories
        case conversationId = "conversation_id"
        case error
    }
}

// MARK: - AnyCodable for flexible JSON decoding
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            value = string
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else {
            value = ""
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let string = value as? String {
            try container.encode(string)
        } else if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let bool = value as? Bool {
            try container.encode(bool)
        }
    }
}
