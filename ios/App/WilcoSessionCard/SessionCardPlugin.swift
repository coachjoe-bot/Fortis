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

    // T49 — the card's tap target. AppDelegate routes wilco://quicklog to
    // SessionCardRouter, which calls this; JS listens with
    // SessionCard.addListener("openQuickLog"). A plugin event, not a window
    // event: triggerWindowJSEvent never reached the WebView here (verified on
    // the simulator 08-11), and this is the channel the bridge is built around.
    public override func load() {
        SessionCardRouter.shared.onRoute = { [weak self] route in
            guard route == "quicklog" else { return }
            DispatchQueue.main.async { self?.notifyListeners("openQuickLog", data: [:]) }
        }
    }

    @objc func show(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.reject("live_activities_unavailable"); return }
        let title = call.getString("title") ?? "TODAY'S SESSION"
        let body = call.getString("body") ?? ""
        // The app's own dark-mode toggle rides every call — the widget process
        // can't read the WebView's localStorage, so JS is the source of truth.
        let dark = call.getBool("dark") ?? false
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
                        state: .init(title: title, lines: lines, startedAt: started, dark: dark),
                        staleDate: nil))
                } else {
                    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                        call.reject("activities_disabled"); return
                    }
                    let state = SessionCardAttributes.ContentState(title: title, lines: lines, startedAt: Date(), dark: dark)
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
