import Foundation

struct IntegrationStatus: Codable {
    let connected: Bool
    let lastSync: Date?

    enum CodingKeys: String, CodingKey {
        case connected
        case lastSync = "last_sync"
    }
}

struct IntegrationsStatusResponse: Codable {
    let google: IntegrationStatus
    let microsoft: IntegrationStatus
}

struct SyncResponse: Codable {
    let memoriesAdded: Int
    let errors: [String]

    enum CodingKeys: String, CodingKey {
        case memoriesAdded = "memories_added"
        case errors
    }
}
