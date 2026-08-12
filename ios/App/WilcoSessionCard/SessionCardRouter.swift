// T49 — deep-link router for the lock-screen session card.
// Target: the App target (NOT the widget extension).
//
// Tapping the Live Activity opens `wilco://quicklog`. That URL arrives in
// AppDelegate, which hands it here. Two arrival orders have to work:
//
//   WARM  — the app is already running, a listener is attached, deliver now.
//   COLD  — the URL lands before the WebView (and its listener) exist, so it is
//           PARKED and replayed the moment SessionCardViewController attaches.
//
// Why not @capacitor/app's `appUrlOpen`: it never reaches the WebView in this
// shell (verified on the simulator 08-11 — the URL reached iOS, the JS listener
// never fired), so the card's tap silently did nothing.
import Foundation

final class SessionCardRouter {
    static let shared = SessionCardRouter()
    private init() {}

    /// Set by SessionCardViewController once the Capacitor bridge is live.
    var onRoute: ((String) -> Void)? {
        didSet {
            guard onRoute != nil, let parked = pending else { return }
            pending = nil
            onRoute?(parked)
        }
    }

    private var pending: String?

    func deliver(_ route: String) {
        if let handler = onRoute {
            handler(route)
        } else {
            pending = route // cold launch: replay when the bridge attaches
        }
    }
}
