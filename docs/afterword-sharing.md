# Sharing Afterword

Afterword has no App Store listing, GitHub release, or auto-updater. Share a
packaged macOS `.app` by hand until a signed release feed exists.

Testers install from [Afterword Tester README](afterword-tester-readme.md). This
page is for the person building and sending the app.

## What to send

- A zip of `Afterword.app` (not the unzipped bundle, and not a `.dmg`)
- [Afterword Tester README](afterword-tester-readme.md)

Do not send `tauri dev`, the git checkout, or anyone’s API keys. Each tester
enters their own Vercel AI Gateway key in **Settings → Summary**. Recording
works without a key; Enhance / summaries need one.

The zip is the app only. Notes stay on the sender’s Mac under
`~/Library/Application Support/com.afterword.app/`. To give someone a meeting,
export Markdown from **Meeting actions → Export Markdown**.

## Build

Use the packaged tester. `tauri dev` is not reliable for other people’s
microphone or system-audio permissions.

```bash
cd frontend
./build-afterword.sh
```

The bundle is:

`target/release/bundle/macos/Afterword.app`

- App name: `Afterword`
- Bundle ID: `com.afterword.app`
- Main binary: `Afterword.app/Contents/MacOS/Afterword`

Confirm **About** shows the intended channel and build ID before you zip.

`.dmg` packaging still fails on this branch. If the script errors after the
`.app` exists, the app bundle is still the artifact to share.

## Zip

Finder copies and some cloud drives strip execute bits inside `.app`. Zip with
`ditto` so permissions survive:

```bash
ditto -c -k --keepParent \
  target/release/bundle/macos/Afterword.app \
  ~/Desktop/Afterword.zip
```

Send `Afterword.zip` plus the tester README. AirDrop, iCloud, Dropbox, or email
all work.

## Message to testers

You can paste:

> Afterword is a Mac app (not the App Store). Unzip `Afterword.zip`. If macOS
> says the app is damaged or won’t open, run:
>
> `xattr -r -d com.apple.quarantine "Afterword.app"`
>
> Then right-click the app → Open, and confirm. Grant Microphone (and Audio
> Capture for system audio). Put your own Vercel AI Gateway key in Settings →
> Summary. Full steps are in the tester README.

## What this is not

- Not notarized. Testers must right-click **Open** the first time.
- Not a Windows or Linux handoff. This path is macOS only.
- Not note sharing or a shared workspace.
- Not Meetily’s upstream updater. Afterword tester builds leave that feed empty.

## After they install

Afterword does not overwrite Meetily. Afterword data is
`~/Library/Application Support/com.afterword.app/`. Original Meetily data stays
in `~/Library/Application Support/com.meetily.ai/` if that app is still installed.
