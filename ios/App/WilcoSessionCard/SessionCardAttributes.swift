// T40 — Lock-screen session card: shared ActivityKit attributes.
// This file belongs to BOTH targets (App + the SessionCardWidget extension) —
// tick both boxes in Target Membership. See XCODE-SETUP.md.
import ActivityKit
import Foundation

struct SessionCardAttributes: ActivityAttributes {
    // The whole card is "state" so an in-chat swap or day correction can update
    // every line of a running activity, not just a counter.
    public struct ContentState: Codable, Hashable {
        var title: String      // "PUSH A · WEEK 3"
        var lines: [String]    // one exercise per entry, weights resolved
        var startedAt: Date
        // The app's OWN theme toggle (localStorage, not the system appearance —
        // WILCO's dark mode is in-app, so the widget can't read it and the JS
        // hands it over on every show/update. Optional so a Live Activity
        // started by an older binary still decodes.
        var dark: Bool?
    }
    // Static for the life of one activity.
    var athleteName: String
}
