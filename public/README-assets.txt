login-bg.jpg / chat-bg.jpg are DUPLICATES of src/assets/*.jpg, kept here on
purpose.

The app imports them through the bundler (src/assets/) so the native OTA build
can inline them as data URIs -- the OTA channel swaps the WebView's server base
path to a snapshot dir holding only index.html, where any absolute /foo.jpg
would 404 and the art renders black.

But sw.js caches the app shell cache-first, so a returning web user can run an
OLD bundle that still requests "/login-bg.jpg". Deleting these from public/
made that request 404 in production and blanked the login hero for anyone on a
cached shell. These copies keep those users working until their service worker
picks up the new shell.

Safe to delete once no cached shell older than 2026-07-30 can plausibly still
be in the wild.
