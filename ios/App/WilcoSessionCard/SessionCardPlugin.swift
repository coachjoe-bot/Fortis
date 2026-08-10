// T40 — Lock-screen session card: Capacitor bridge.
// Target: the App target (NOT the widget extension).
// JS calls (src/sessionCard.js, feature-detected):
//   SessionCard.show({title, body})  — start the Live Activity, or update the
//                                      running one in place (swaps, day fixes)
//   SessionCard.end()                — session logged / athlete said take it down
import Foundation
import Capacitor
import ActivityKit

@objc(SessionCardPlugin)
public class SessionCardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SessionCardPlugin"
    public let jsName = "SessionCard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    @objc func show(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.reject("live_activities_unavailable"); return }
        let title = call.getString("title") ?? "TODAY'S SESSION"
        let body = call.getString("body") ?? ""
        let lines = body.components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard !lines.isEmpty else { call.reject("empty_card"); return }
        Task {
            do {
                if let existing = Activity<SessionCardAttributes>.activities.first {
                    // An update NEVER resets the started-at clock — the card
                    // started when the athlete pinned it, not when it re-rendered.
                    let started = existing.content.state.startedAt
                    await existing.update(ActivityContent(
                        state: .init(title: title, lines: lines, startedAt: started),
                        staleDate: nil))
                } else {
                    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                        call.reject("activities_disabled"); return
                    }
                    let state = SessionCardAttributes.ContentState(title: title, lines: lines, startedAt: Date())
                    _ = try Activity.request(
                        attributes: SessionCardAttributes(athleteName: ""),
                        content: ActivityContent(state: state, staleDate: nil))
                }
                call.resolve()
            } catch {
                call.reject("activity_error", nil, error)
            }
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        Task {
            for activity in Activity<SessionCardAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }
}
