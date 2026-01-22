import Foundation

struct User: Codable, Identifiable {
    let id: UUID
    let email: String
    let name: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case email
        case name
        case createdAt = "created_at"
    }
}
