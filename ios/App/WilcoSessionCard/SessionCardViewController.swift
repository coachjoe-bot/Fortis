// T40 — Lock-screen session card: bridge view controller.
// Target: the App target. Capacitor does not auto-discover custom in-app
// plugins, so the storyboard's view controller is pointed at this subclass and
// the plugin registers here. If the app ever grows another custom plugin, it
// registers in the same place.
//
// T49: it is also where the card's deep link (wilco://quicklog) crosses into
// JS — SessionCardRouter hands the route over and this fires a window event the
// app listens for. Assigning the handler replays a route parked during a cold
// launch, so a tap that started the app lands in Quick Log too.
import UIKit
import Capacitor

class SessionCardViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // Wire the router against the SAME instance we register: load() is not
        // guaranteed to run for an instance registered this way, so the plugin's
        // own hookup can silently never happen.
        let plugin = SessionCardPlugin()
        bridge?.registerPluginInstance(plugin)
        SessionCardRouter.shared.onRoute = { [weak plugin] route in
            guard route == "quicklog" else { return }
            DispatchQueue.main.async { plugin?.notifyListeners("openQuickLog", data: [:]) }
        }
    }
}
