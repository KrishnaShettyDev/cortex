import SwiftUI

extension Color {
    // MARK: - Dark Theme Backgrounds (Japanese minimal)
    static let bgPrimary = Color(hex: "0D0D0D")       // Deep black
    static let bgSecondary = Color(hex: "1A1A1A")     // Slightly lighter
    static let bgTertiary = Color(hex: "242424")      // Card background
    static let bgCard = Color(hex: "1E1E1E").opacity(0.8)

    // MARK: - Glassmorphic
    static let glassLight = Color.white.opacity(0.08)
    static let glassBorder = Color.white.opacity(0.12)
    static let glassHighlight = Color.white.opacity(0.15)

    // MARK: - Accent Gradient (Soft pastel like Iris)
    static let accentMint = Color(hex: "7DD3C0")      // Soft mint/teal
    static let accentLavender = Color(hex: "C4B5E0")  // Soft lavender
    static let accentPeach = Color(hex: "E8C4B8")     // Soft peach/rose
    static let accent = Color(hex: "7DD3C0")          // Primary accent (mint)

    // MARK: - Text
    static let textPrimary = Color.white
    static let textSecondary = Color(hex: "A0A0A0")
    static let textTertiary = Color(hex: "666666")

    // MARK: - Semantic
    static let success = Color(hex: "7DD3C0")         // Mint
    static let warning = Color(hex: "E8C4B8")         // Peach
    static let error = Color(hex: "E57373")           // Soft red

    // MARK: - Memory Types (Soft pastels)
    static let voiceMemory = Color(hex: "C4B5E0")     // Lavender
    static let textMemory = Color(hex: "7DD3C0")      // Mint
    static let photoMemory = Color(hex: "E8C4B8")     // Peach
    static let emailMemory = Color(hex: "90CAF9")     // Soft blue
    static let calendarMemory = Color(hex: "FFF59D")  // Soft yellow

    // MARK: - Hex Initializer
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }

    // MARK: - Memory Type Color
    static func memoryColor(for type: String) -> Color {
        switch type {
        case "voice": return .voiceMemory
        case "text": return .textMemory
        case "photo": return .photoMemory
        case "email": return .emailMemory
        case "calendar": return .calendarMemory
        default: return .accent
        }
    }

    // MARK: - Gradient
    static var accentGradient: LinearGradient {
        LinearGradient(
            colors: [.accentMint, .accentLavender, .accentPeach],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}
