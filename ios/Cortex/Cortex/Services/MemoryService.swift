import Foundation

class MemoryService {
    static let shared = MemoryService()
    private let api = APIService.shared

    private init() {}

    // MARK: - Create Memory
    func createMemory(
        content: String,
        type: MemoryType,
        date: Date,
        audioUrl: String? = nil,
        photoUrl: String? = nil
    ) async throws -> MemoryCreateResponse {
        let request = MemoryCreateRequest(
            content: content,
            memoryType: type.rawValue,
            memoryDate: date,
            audioUrl: audioUrl,
            photoUrl: photoUrl
        )

        return try await api.request(
            endpoint: "/memories",
            method: "POST",
            body: request
        )
    }

    // MARK: - List Memories
    func listMemories(
        limit: Int = 20,
        offset: Int = 0,
        type: MemoryType? = nil,
        fromDate: Date? = nil,
        toDate: Date? = nil
    ) async throws -> MemoryListResponse {
        var endpoint = "/memories?limit=\(limit)&offset=\(offset)"

        if let type = type {
            endpoint += "&type=\(type.rawValue)"
        }
        if let fromDate = fromDate {
            endpoint += "&from=\(ISO8601DateFormatter().string(from: fromDate))"
        }
        if let toDate = toDate {
            endpoint += "&to=\(ISO8601DateFormatter().string(from: toDate))"
        }

        return try await api.request(endpoint: endpoint)
    }

    // MARK: - Search Memories
    func searchMemories(query: String, limit: Int = 10) async throws -> MemorySearchResponse {
        let encodedQuery = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        return try await api.request(endpoint: "/memories/search?q=\(encodedQuery)&limit=\(limit)")
    }

    // MARK: - Get Memory
    func getMemory(id: UUID) async throws -> Memory {
        return try await api.request(endpoint: "/memories/\(id)")
    }

    // MARK: - Delete Memory
    func deleteMemory(id: UUID) async throws {
        struct Response: Codable {
            let success: Bool
        }

        let _: Response = try await api.request(
            endpoint: "/memories/\(id)",
            method: "DELETE"
        )
    }

    // MARK: - Upload Audio
    func uploadAudio(data: Data) async throws -> String {
        let response = try await api.upload(
            endpoint: "/upload/audio",
            fileData: data,
            fileName: "recording.m4a",
            mimeType: "audio/m4a"
        )
        return response.url
    }

    // MARK: - Upload Photo
    func uploadPhoto(data: Data) async throws -> String {
        let response = try await api.upload(
            endpoint: "/upload/photo",
            fileData: data,
            fileName: "photo.jpg",
            mimeType: "image/jpeg"
        )
        return response.url
    }
}
