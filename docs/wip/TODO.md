# TODO

## Now
- [ ] Fix DMG bundling in `bundle_dmg.sh` so peer distribution is drag-install ready.
- [ ] Verify a true first-run packaged tester flow on clean `com.meetnola.tester` app data.

## Next
- [ ] Remove remaining safe user-facing `Meetily` strings where they still appear in the UI.
- [ ] Fix macOS app/window branding that still shows the old Meetily identity in the menu bar and app switcher.
- [ ] Tighten modal styling so settings/model dialogs match the warm stone palette used in the main app.
- [ ] Add optional Deepgram transcription support so users can enable it in Settings with their own API key, while keeping current providers and defaults unchanged.
- [ ] Add precise transcript-range chat on meeting details instead of expanding homepage scope further.
- [ ] Make the expanded sidebar resizable within a defined min/max width range.

## Homepage
- [ ] Continue homepage density tuning if needed after peer feedback.
  Current direction: show more title text and keep the bottom AI bar persistent.

## Packaging
- [ ] Keep `meetnola Tester.app` as the peer-test target until DMG packaging is fixed.
- [ ] Decide whether to notarize tester builds or continue with right-click `Open` instructions.

## Known Issues
- [ ] DMG packaging still fails after the `.app` bundle is produced.
- [ ] Tester build is ad-hoc signed, not notarized.
