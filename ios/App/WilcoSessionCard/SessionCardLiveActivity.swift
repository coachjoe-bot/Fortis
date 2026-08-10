// T40 — Lock-screen session card: the Live Activity UI.
// Target: the SessionCardWidget EXTENSION only (not the App target).
// A pinned, unburiable lock-screen card: day label + every exercise at real
// weights. Deliberately static — no check-offs, no progress (Will's spec:
// it's a reference sheet; logging the session ends the whole activity).
import ActivityKit
import SwiftUI
import WidgetKit

// Brand ink — WILCO navy on the system material keeps it legible on any
// wallpaper; the accent bar is the only decoration.
private let wilcoNavy = Color(red: 0x28 / 255, green: 0x50 / 255, blue: 0x8B / 255)

@main
struct SessionCardWidgetBundle: WidgetBundle {
    var body: some Widget {
        SessionCardLiveActivity()
    }
}

struct SessionCardLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SessionCardAttributes.self) { context in
            // ── Lock screen / notification-area presentation ──
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Rectangle()
                        .fill(wilcoNavy)
                        .frame(width: 3, height: 12)
                        .cornerRadius(1.5)
                    Text(context.state.title)
                        .font(.system(size: 13, weight: .heavy))
                        .kerning(0.8)
                        .lineLimit(1)
                    Spacer()
                    Text("WILCO")
                        .font(.system(size: 10, weight: .heavy))
                        .kerning(1.5)
                        .foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 2.5) {
                    ForEach(context.state.lines.prefix(8), id: \.self) { line in
                        Text(line)
                            .font(.system(size: 12.5, weight: .medium).monospacedDigit())
                            .lineLimit(1)
                    }
                }
                HStack {
                    Text("STARTED \(context.state.startedAt, style: .time)")
                    Spacer()
                    Text("LOG IT AND THIS CLEARS")
                }
                .font(.system(size: 9, weight: .semibold))
                .kerning(0.5)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
            }
            .padding(14)
            .activityBackgroundTint(nil) // system material — right on any wallpaper
            .activitySystemActionForegroundColor(wilcoNavy)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded (long-press on the island)
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.title)
                        .font(.system(size: 13, weight: .heavy))
                        .kerning(0.6)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(context.state.lines.prefix(5), id: \.self) { line in
                            Text(line)
                                .font(.system(size: 12, weight: .medium).monospacedDigit())
                                .lineLimit(1)
                        }
                    }
                }
            } compactLeading: {
                Text("W")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(wilcoNavy)
            } compactTrailing: {
                Text(context.state.title.components(separatedBy: " ·").first ?? "SESSION")
                    .font(.system(size: 11, weight: .bold))
                    .lineLimit(1)
            } minimal: {
                Text("W")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(wilcoNavy)
            }
        }
    }
}
