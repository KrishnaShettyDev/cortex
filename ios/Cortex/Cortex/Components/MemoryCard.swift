import SwiftUI

struct MemoryCard: View {
    let memory: Memory

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                // Type indicator
                HStack(spacing: 6) {
                    Image(systemName: memory.memoryType.icon)
                        .font(.caption)
                    Text(memory.memoryType.displayName)
                        .font(.caption)
                }
                .foregroundColor(Color.memoryColor(for: memory.memoryType.rawValue))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Color.memoryColor(for: memory.memoryType.rawValue).opacity(0.1))
                .cornerRadius(8)

                Spacer()

                // Date
                Text(formatDate(memory.memoryDate))
                    .font(.caption)
                    .foregroundColor(.textTertiary)
            }

            // Content
            if let summary = memory.summary {
                Text(summary)
                    .font(.bodyMedium)
                    .foregroundColor(.textPrimary)
                    .lineLimit(2)
            } else {
                Text(memory.content)
                    .font(.bodyMedium)
                    .foregroundColor(.textPrimary)
                    .lineLimit(3)
            }

            // Photo preview
            if let photoUrl = memory.photoUrl {
                AsyncImage(url: URL(string: photoUrl)) { image in
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(height: 120)
                        .clipped()
                        .cornerRadius(8)
                } placeholder: {
                    Rectangle()
                        .fill(Color.bgSecondary)
                        .frame(height: 120)
                        .cornerRadius(8)
                }
            }

            // Entities
            if !memory.entities.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(memory.entities, id: \.self) { entity in
                            Text(entity)
                                .font(.captionSmall)
                                .foregroundColor(.textSecondary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.bgSecondary)
                                .cornerRadius(6)
                        }
                    }
                }
            }
        }
        .padding()
        .glassCard()
    }

    private func formatDate(_ date: Date) -> String {
        let calendar = Calendar.current
        let now = Date()

        if calendar.isDateInToday(date) {
            return "Today, " + date.formatted(date: .omitted, time: .shortened)
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday, " + date.formatted(date: .omitted, time: .shortened)
        } else if calendar.isDate(date, equalTo: now, toGranularity: .weekOfYear) {
            return date.formatted(.dateTime.weekday(.wide).hour().minute())
        } else if calendar.isDate(date, equalTo: now, toGranularity: .year) {
            return date.formatted(.dateTime.month(.abbreviated).day())
        } else {
            return date.formatted(.dateTime.year().month(.abbreviated).day())
        }
    }
}

#Preview {
    VStack {
        MemoryCard(memory: Memory(
            id: UUID(),
            content: "Had a great meeting with John about the new project. We discussed the timeline and agreed to deliver by Q2. Need to follow up on the budget concerns.",
            summary: "Meeting with John about new project, delivering Q2",
            memoryType: .voice,
            sourceId: nil,
            sourceUrl: nil,
            audioUrl: nil,
            photoUrl: nil,
            memoryDate: Date(),
            createdAt: Date(),
            entities: ["John", "Project Alpha"]
        ))
    }
    .padding()
    .background(Color.bgPrimary)
}
