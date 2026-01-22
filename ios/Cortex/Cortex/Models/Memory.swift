import Foundation

enum MemoryType: String, Codable, CaseIterable {
    case voice
    case text
    case photo
    case email
    case calendar

    var icon: String {
        switch self {
        case .voice: return "mic.fill"
        case .text: return "text.bubble.fill"
        case .photo: return "photo.fill"
        case .email: return "envelope.fill"
        case .calendar: return "calendar"
        }
    }

    var displayName: String {
        switch self {
        case .voice: return "Voice"
        case .text: return "Text"
        case .photo: return "Photo"
        case .email: return "Email"
        case .calendar: return "Calendar"
        }
    }
}

struct Memory: Codable, Identifiable {
    let id: UUID
    let content: String
    let summary: String?
    let memoryType: MemoryType
    let sourceId: String?
    let sourceUrl: String?
    let audioUrl: String?
    let photoUrl: String?
    let memoryDate: Date
    let createdAt: Date
    let entities: [String]

    enum CodingKeys: String, CodingKey {
        case id
        case content
        case summary
        case memoryType = "memory_type"
        case sourceId = "source_id"
        case sourceUrl = "source_url"
        case audioUrl = "audio_url"
        case photoUrl = "photo_url"
        case memoryDate = "memory_date"
        case createdAt = "created_at"
        case entities
    }
}

struct MemoryCreateRequest: Codable {
    let content: String
    let memoryType: String
    let memoryDate: Date
    let audioUrl: String?
    let photoUrl: String?

    enum CodingKeys: String, CodingKey {
        case content
        case memoryType = "memory_type"
        case memoryDate = "memory_date"
        case audioUrl = "audio_url"
        case photoUrl = "photo_url"
    }
}

struct MemoryCreateResponse: Codable {
    let memoryId: UUID
    let entitiesExtracted: [String]

    enum CodingKeys: String, CodingKey {
        case memoryId = "memory_id"
        case entitiesExtracted = "entities_extracted"
    }
}

struct MemoryListResponse: Codable {
    let memories: [Memory]
    let total: Int
    let offset: Int
    let limit: Int
}

struct MemorySearchResponse: Codable {
    let memories: [Memory]
    let queryUnderstood: String

    enum CodingKeys: String, CodingKey {
        case memories
        case queryUnderstood = "query_understood"
    }
}
