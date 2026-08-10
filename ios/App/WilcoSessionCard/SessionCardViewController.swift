// T40 — Lock-screen session card: bridge view controller.
// Target: the App target. Capacitor does not auto-discover custom in-app
// plugins, so the storyboard's view controller is pointed at this subclass and
// the plugin registers here. If the app ever grows another custom plugin, it
// registers in the same place.
import UIKit
import Capacitor

class SessionCardViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SessionCardPlugin())
    }
}
