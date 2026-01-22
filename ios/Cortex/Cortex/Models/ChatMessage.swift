import Foundation

struct ChatMessage: Identifiable {
    let id: UUID
    let role: ChatRole
    let content: String
    let memoriesUsed: [MemoryReference]?
    let timestamp: Date

    init(id: UUID = UUID(), role: ChatRole, content: String, memoriesUsed: [MemoryReference]? = nil, timestamp: Date = Date()) {
        self.id = id
        self.role = role
        self.content = content
        self.memoriesUsed = memoriesUsed
        self.timestamp = timestamp
    }
}

enum ChatRole {
    case user
    case assistant
}

struct MemoryReference: Codable, Identifiable {
    let id: UUID
    let content: String
    let memoryType: String
    let memoryDate: Date

    enum CodingKeys: String, CodingKey {
        case id
        case content
        case memoryType = "memory_type"
        case memoryDate = "memory_date"
    }
}

struct ChatRequest: Codable {
    let message: String
    let conversationId: String?

    enum CodingKeys: String, CodingKey {
        case message
        case conversationId = "conversation_id"
    }
}

struct ChatResponse: Codable {
    let response: String
    let memoriesUsed: [MemoryReference]
    let conversationId: String

    enum CodingKeys: String, CodingKey {
        case response
        case memoriesUsed = "memories_used"
        case conversationId = "conversation_id"
    }
}
