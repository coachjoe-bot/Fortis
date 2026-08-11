// T40 — Lock-screen session card: the Live Activity UI.
// Target: the SessionCardWidget EXTENSION only (not the App target).
// A pinned, unburiable lock-screen card: day label + every exercise at real
// weights. Deliberately static — no check-offs, no progress (Will's spec:
// it's a reference sheet; logging the session ends the whole activity).
//
// T49 restyle (Will, 08-11): the card is a page from a training journal —
// warm paper ground, serif headline, dictionary-style navy numerals — the
// same editorial language as the relight's login definition and The Proof.
// Paper is deliberate: every other app's Live Activity is dark glass, ours
// reads as the one physical object on the lock screen.
import ActivityKit
import SwiftUI
import WidgetKit

private let wilcoNavy = Color(red: 0x28 / 255, green: 0x50 / 255, blue: 0x8B / 255)
private let paper     = Color(red: 0xF7 / 255, green: 0xF4 / 255, blue: 0xEC / 255)
private let ink       = Color(red: 0x1C / 255, green: 0x25 / 255, blue: 0x32 / 255)
private let inkMuted  = Color(red: 0x5B / 255, green: 0x66 / 255, blue: 0x75 / 255)
private let hairline  = Color(red: 0xD9 / 255, green: 0xD2 / 255, blue: 0xC3 / 255)

@main
struct SessionCardWidgetBundle: WidgetBundle {
    var body: some Widget {
        SessionCardLiveActivity()
    }
}

struct SessionCardLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SessionCardAttributes.self) { context in
            // ── Lock screen: the journal page ──
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .firstTextBaseline) {
                    Text("WILCO")
                        .font(.system(size: 11, weight: .heavy))
                        .kerning(2.0)
                        .foregroundStyle(wilcoNavy)
                    Spacer()
                    Text("TODAY'S SESSION")
                        .font(.system(size: 8.5, weight: .semibold))
                        .kerning(1.2)
                        .foregroundStyle(inkMuted)
                }
                Rectangle().fill(hairline).frame(height: 1)
                Text(context.state.title)
                    .font(.system(size: 16, weight: .bold, design: .serif))
                    .foregroundStyle(ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(context.state.lines.prefix(8).enumerated()), id: \.offset) { i, line in
                        HStack(alignment: .firstTextBaseline, spacing: 7) {
                            Text("\(i + 1)")
                                .font(.system(size: 12, weight: .bold, design: .serif))
                                .foregroundStyle(wilcoNavy)
                                .frame(width: 10, alignment: .trailing)
                            Text(line)
                                .font(.system(size: 12.5, weight: .medium).monospacedDigit())
                                .foregroundStyle(ink)
                                .lineLimit(1)
                        }
                    }
                }
                Rectangle().fill(hairline).frame(height: 1).padding(.top, 1)
                HStack {
                    Text("STARTED \(context.state.startedAt, style: .time)")
                        .foregroundStyle(inkMuted)
                    Spacer()
                    Text("LOG IT AND THIS CLEARS")
                        .foregroundStyle(wilcoNavy)
                }
                .font(.system(size: 9, weight: .semibold))
                .kerning(0.6)
            }
            .padding(14)
            .activityBackgroundTint(paper)
            .activitySystemActionForegroundColor(ink)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded (long-press on the island) — island stays system-dark;
                // serif headline + navy numerals carry the journal voice there.
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.title)
                        .font(.system(size: 13, weight: .bold, design: .serif))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(context.state.lines.prefix(5).enumerated()), id: \.offset) { i, line in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("\(i + 1)")
                                    .font(.system(size: 11, weight: .bold, design: .serif))
                                    .foregroundStyle(wilcoNavy)
                                Text(line)
                                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                                    .lineLimit(1)
                            }
                        }
                    }
                }
            } compactLeading: {
                Text("W")
                    .font(.system(size: 13, weight: .heavy, design: .serif))
                    .foregroundStyle(wilcoNavy)
            } compactTrailing: {
                Text(context.state.title.components(separatedBy: " ·").first ?? "SESSION")
                    .font(.system(size: 11, weight: .bold, design: .serif))
                    .lineLimit(1)
            } minimal: {
                Text("W")
                    .font(.system(size: 12, weight: .heavy, design: .serif))
                    .foregroundStyle(wilcoNavy)
            }
        }
    }
}
