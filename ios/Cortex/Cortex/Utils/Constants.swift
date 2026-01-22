import Foundation

enum Constants {
    // Use localhost for simulator, your machine's IP for physical device
    #if DEBUG
    #if targetEnvironment(simulator)
    static let apiBaseURL = "http://localhost:8000"
    #else
    static let apiBaseURL = "http://192.168.1.34:8000"  // Your Mac's IP for physical device
    #endif
    #else
    static let apiBaseURL = "https://api.cortex.app"  // Change for production
    #endif

    enum Keychain {
        static let accessTokenKey = "cortex_access_token"
        static let refreshTokenKey = "cortex_refresh_token"
        static let serviceName = "com.cortex.app"
    }
}
