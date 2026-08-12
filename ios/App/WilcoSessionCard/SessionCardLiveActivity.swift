// T40 — Lock-screen session card: the Live Activity UI.
// Target: the SessionCardWidget EXTENSION only (not the App target).
// A pinned, unburiable lock-screen card: day label + every exercise at real
// weights. Deliberately static — no check-offs, no progress (Will's spec:
// it's a reference sheet; logging the session ends the whole activity).
//
// T49 restyle (Will, 08-11): the card is a page from a training journal —
// paper ground, serif headline, dictionary-style navy numerals — the same
// editorial language as the relight's login definition and The Proof. Paper is
// deliberate: every other app's Live Activity is dark glass, ours reads as the
// one physical object on the lock screen.
//
// T49 round 2 (Will, 08-11): generous padding so no kerned letter clips at the
// corners, the "LOG IT AND THIS CLEARS" footer removed, tapping the card opens
// Quick Log (widgetURL below → wilco://quicklog → src/App.jsx router), and the
// whole palette flips with the app's own dark-mode toggle.
import ActivityKit
import SwiftUI
import WidgetKit

// One palette, two grounds. Light is the journal page; dark is the same page
// in the frozen night-gym theme (values from the app's CA_DARK).
private struct CardInk {
    let paper: Color, ink: Color, muted: Color, rule: Color, accent: Color

    static let light = CardInk(
        paper:  Color(red: 0xF7 / 255, green: 0xF4 / 255, blue: 0xEC / 255),
        ink:    Color(red: 0x1C / 255, green: 0x25 / 255, blue: 0x32 / 255),
        muted:  Color(red: 0x5B / 255, green: 0x66 / 255, blue: 0x75 / 255),
        rule:   Color(red: 0xD9 / 255, green: 0xD2 / 255, blue: 0xC3 / 255),
        accent: Color(red: 0x28 / 255, green: 0x50 / 255, blue: 0x8B / 255))

    static let dark = CardInk(
        paper:  Color(red: 0x0A / 255, green: 0x0F / 255, blue: 0x1D / 255),
        ink:    Color(red: 0xE6 / 255, green: 0xEC / 255, blue: 0xF6 / 255),
        muted:  Color(red: 0x7C / 255, green: 0x8A / 255, blue: 0xA3 / 255),
        rule:   Color(red: 0x25 / 255, green: 0x37 / 255, blue: 0x5D / 255),
        accent: Color(red: 0x3A / 255, green: 0x7B / 255, blue: 0xFF / 255))

    static func of(_ state: SessionCardAttributes.ContentState) -> CardInk {
        (state.dark ?? false) ? .dark : .light
    }
}

// Tapping anywhere on the card lands in Quick Log with today's draft loaded.
private let quickLogURL = URL(string: "wilco://quicklog")!

@main
struct SessionCardWidgetBundle: WidgetBundle {
    var body: some Widget {
        SessionCardLiveActivity()
    }
}

struct SessionCardLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SessionCardAttributes.self) { context in
            let c = CardInk.of(context.state)
            // ── Lock screen: the journal page ──
            // HEIGHT IS THE CONSTRAINT: iOS gives a lock-screen Live Activity
            // ~160pt and CLIPS whatever overflows (top and bottom both, so a
            // too-tall card loses its masthead AND its footer). Hence one
            // masthead row carrying both the brand and the start time, a single
            // rule, and a 6-lift ceiling — not a stack of separate rows.
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    // Trailing padding on every kerned run: kerning adds space
                    // AFTER the last glyph, which the layout otherwise clips.
                    Text("WILCO")
                        .font(.system(size: 10.5, weight: .heavy))
                        .kerning(1.8)
                        .foregroundStyle(c.accent)
                        .padding(.trailing, 3)
                    Spacer(minLength: 10)
                    Text("STARTED \(context.state.startedAt, style: .time)")
                        .font(.system(size: 8.5, weight: .semibold))
                        .kerning(0.8)
                        .foregroundStyle(c.muted)
                        .padding(.trailing, 3)
                }
                Rectangle().fill(c.rule).frame(height: 1)
                Text(context.state.title)
                    .font(.system(size: 15, weight: .bold, design: .serif))
                    .foregroundStyle(c.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.trailing, 3)
                VStack(alignment: .leading, spacing: 2.5) {
                    ForEach(Array(context.state.lines.prefix(6).enumerated()), id: \.offset) { i, line in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\(i + 1)")
                                .font(.system(size: 11.5, weight: .bold, design: .serif))
                                .foregroundStyle(c.accent)
                                .frame(width: 11, alignment: .trailing)
                            Text(line)
                                .font(.system(size: 12, weight: .medium).monospacedDigit())
                                .foregroundStyle(c.ink)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                    }
                }
            }
            .padding(.horizontal, 17)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(quickLogURL)
            .activityBackgroundTint(c.paper)
            .activitySystemActionForegroundColor(c.ink)
        } dynamicIsland: { context in
            let c = CardInk.of(context.state)
            return DynamicIsland {
                // Expanded (long-press on the island) — the island ground is
                // Apple's, always dark; the voice carries through serif + accent.
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.title)
                        .font(.system(size: 13, weight: .bold, design: .serif))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(Array(context.state.lines.prefix(5).enumerated()), id: \.offset) { i, line in
                            HStack(alignment: .firstTextBaseline, spacing: 7) {
                                Text("\(i + 1)")
                                    .font(.system(size: 11, weight: .bold, design: .serif))
                                    .foregroundStyle(c.accent)
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
                    .foregroundStyle(c.accent)
            } compactTrailing: {
                Text(context.state.title.components(separatedBy: " ·").first ?? "SESSION")
                    .font(.system(size: 11, weight: .bold, design: .serif))
                    .lineLimit(1)
            } minimal: {
                Text("W")
                    .font(.system(size: 12, weight: .heavy, design: .serif))
                    .foregroundStyle(c.accent)
            }
            .widgetURL(quickLogURL)
        }
    }
}
