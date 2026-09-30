# Native patches

## `react-native-screens+4.16.0.patch` — UIKit's iOS 18 zoom transition

**Status: spike. Not applied automatically — `patch-package` is not installed.**

Adds UIKit's real zoom transition (`UIViewController.preferredTransition = .zoom`,
the App Store card-grows-into-screen animation) to pushed screens.

Note: the zoom is an **iOS 18** API. iOS 26 only adds a bar-button-item source
variant (`zoomWithOptions:sourceBarButtonItemProvider:`), which does not apply
to a list row.
`react-native-screens` has no zoom support and no way to name the source view a
transition should grow out of, so the patch reads the source straight off the
view hierarchy: JS marks the row it is about to open with
`testID="rns-zoom-source"` and the push picks it up. The destination marks its
header `testID="rns-zoom-target"`, which feeds `alignmentRectProvider` so UIKit
lands the row on the header instead of on the screen's safe-area padding. See
`src/lib/native-zoom.ts`.

Verified working on iOS 26.5 simulator — the hook fires at push time, finds the
marked row at its real rect, and UIKit accepts the transition.

### To use it

```bash
npm i -D patch-package && npm pkg set scripts.postinstall="patch-package"
npx patch-package     # or npm install, once postinstall is wired
npx expo run:ios      # native rebuild required
```

Then flip `NATIVE_ZOOM_SPIKE` to `true` in `src/lib/native-zoom.ts`.

### Constraints

- **iOS 18+ only.** Older iOS and Android fall through to the default push, so
  the JS zoom in `src/components/zoom-screen.tsx` stays the portable path.
- **`animation: 'default'` only.** `RNSScreenStack.mm` returns a custom animator
  for every other value, and a custom animator overrides `preferredTransition`.
- **Re-apply on every `react-native-screens` upgrade.** This patches internals.
- **No pull-down dismissal, by choice.** UIKit offers the zoom's interactive
  pull-down only to a *presented* view controller, and every modal style that
  provides it renders as a sheet rather than a full screen. Measured: presenting
  with `presentation: 'modal'` resolved to `modalPresentationStyle = 2`
  (form sheet). Since this screen must stay a screen, it is pushed, and the
  left-edge back swipe dismisses it — which zooms back out to the source row
  just the same. `interactiveDismissShouldBegin` was implemented and then
  removed as dead code; restore it from git history if the screen ever becomes
  a modal.
