# Lock-screen session card — Xcode wiring (T40, ~10 minutes)

The Swift in this folder is complete but **unreferenced** — nothing here is in
any target until these steps run, so the archive builds exactly as before
until they do. `Info.plist` already carries `NSSupportsLiveActivities`.

The JS side (src/sessionCard.js) feature-detects the plugin: before these
steps the native app falls back to web notifications; after them it gets the
pinned Live Activity with zero JS changes.

## 1. Widget extension target
1. Xcode → File → New → Target… → **Widget Extension**.
2. Product Name: `SessionCardWidget`. **Uncheck "Include Configuration App
   Intent"** (the "Include Live Activity" checkbox doesn't matter — the
   template files get deleted next step either way). Team: Wilco Training LLC.
   Activate the scheme when prompted.
3. Delete every template `.swift` file Xcode generated inside the new
   `SessionCardWidget` group (the bundle/entry files — we ship our own).
4. Add `SessionCardLiveActivity.swift` to the **SessionCardWidget** target
   (File Inspector → Target Membership).
5. Add `SessionCardAttributes.swift` to **BOTH** targets: App AND
   SessionCardWidget.
6. Widget extension's deployment target: **iOS 16.2**.

## 2. App target
1. Add `SessionCardPlugin.swift` and `SessionCardViewController.swift` to the
   **App** target only.
2. Open `App/Base.lproj/Main.storyboard` → select the view controller →
   Identity Inspector → Custom Class: `SessionCardViewController`
   (Module: App). This is how the plugin registers with the Capacitor bridge —
   custom in-app plugins are not auto-discovered.

## 3. Verify
1. Build to a simulator (iOS 17+ sim shows Live Activities on its lock screen).
2. In the app: ask Joe "what's my workout today" → tap "Put it on my lock
   screen" → Cmd+L to lock the sim → the card should be PINNED at the bottom
   of the lock screen, WILCO navy accent bar, day label + exercises.
3. Log the session → the card ends and disappears.
4. Say "take it off my lock screen" in chat → same.

## Notes
- The activity is started/updated/ended only while the app is open (the
  athlete logs in the app anyway), so no push token, no APNs involvement, no
  `liveactivity` push type — nothing new for the server.
- iOS caps a Live Activity at 8h active; ours ends at log time or is ended by
  the 3h staleness sweep on next app open, far inside the cap.
- Do NOT add this folder's files to the target lists via `npx cap sync` or any
  script — target membership is deliberate and manual, per above.
