# Afterword Tester README

If you received a zip of `Afterword.app`, start at [First Run](#first-run) and
[What You Need To Do](#what-you-need-to-do). To build and send a copy, see
[Sharing Afterword](afterword-sharing.md).

## What This Is
`Afterword.app` is a separate peer-test build of Afterword for macOS. (Afterword was
previously called Meetnola.) There is no App Store listing or auto-update for
this fork; someone sends you a zip of the app.

- App name: `Afterword`
- Bundle ID: `com.afterword.app`
- It is separate from the original `Meetily.app`

## If You Already Have Meetily
That is fine.

`Afterword` does **not** overwrite the original Meetily app or its notes database.

- Original Meetily app data: `~/Library/Application Support/com.meetily.ai/`
- Afterword app data: `~/Library/Application Support/com.afterword.app/`

The tester build can run side-by-side with the original app.

## First Run
On first launch, the app will:

1. Create its own clean app-data folder under `~/Library/Application Support/com.afterword.app/`
2. Start onboarding
3. Default **Transcription** to local **Parakeet** (Whisper also available)
4. Default **Summary / Enhance** to **Vercel AI Gateway** via Custom OpenAI (`https://ai-gateway.vercel.sh/v1`, model `openai/gpt-5.6-luna`)
5. Skip local model downloads during onboarding (download Parakeet later from Settings)
6. Route you to **Settings → Summary** if no Gateway API key is present

Recording works without a Gateway key. Summaries/Enhance need your Gateway API key (never baked into the build).
Existing installs retain their settings and keys, but this recovery baseline supports local transcription only. If an existing install has Groq selected for transcription, choose **Parakeet** or **Local Whisper** and download a model before recording. Groq summary settings are separate.

## What You Need To Do
1. Unzip `Afterword.zip`. Move `Afterword.app` to **Applications** if you want.

2. Remove the quarantine flag

   Downloaded apps are often quarantined by macOS. Clear it with:

   ```bash
   xattr -r -d com.apple.quarantine "Afterword.app"
   ```

   Adjust the path if you moved the app, for example
   `/Applications/Afterword.app`.

3. Open the app

   The app is ad-hoc signed, not notarized. Double-click often fails.

   - right-click the app
   - click **Open**
   - confirm the security prompt

4. Fix executable permissions if launch fails

   Some archive/unzip paths strip execute permission from binaries inside the
   app. If launch fails with `Launch failed`, `permission denied`, or error
   code `111`, run:

   ```bash
   chmod +x /Applications/Afterword.app/Contents/MacOS/*
   ```

   Use the path to your copy of the app if it is not in Applications. The main
   binary is `Afterword` (not `meetily`). Sidecars such as `ffmpeg` and
   `llama-helper` may include a target-triple suffix.

5. Grant permissions when prompted
   - **Microphone**
   - **Audio Capture** if you want system audio recording

6. Configure Vercel AI Gateway (summaries)
   - Open **Settings → Summary**
   - Choose Custom Server / AI Gateway (or apply the Gateway preset)
   - Paste your own Gateway API key

   Recording works without a key. Enhance / summaries need one. Keys are never
   included in the zip.

## Defaults
- Analytics: **off by default**
- Summary provider: **custom-openai** → Vercel AI Gateway (`openai/gpt-5.6-luna`)
- Transcript provider: **parakeet** (local)
- Local STT models: optional download after onboarding
- Gateway API key: required only for summaries/Enhance

## Recordings Folder
New default recordings go to:

- macOS: `~/Movies/afterword-recordings/`

This is the path the app actually uses (`audio/recording_preferences.rs`).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Launch failed`, error `111`, or `permission denied` | Binaries inside the app bundle lost executable permission during extraction | Run `chmod +x` on everything in `Contents/MacOS/` |
| `app is damaged` or Gatekeeper blocks launch | macOS quarantine attribute is still attached to the app | Run `xattr -r -d com.apple.quarantine "Afterword.app"` |
| Security prompt will not go away | The app is ad-hoc signed and not trusted yet | Right-click the app, click **Open**, then confirm the dialog |

## Current Limitations
- The `.app` bundle works for testing.
- The `.dmg` packaging step is still not fixed in this branch.
- The app is ad-hoc signed, not notarized.
- Archive extraction may strip executable permissions from the bundled binaries. If that happens, use the `chmod +x` step above.

## Good Peer-Test Checks
1. Complete onboarding
2. Add a Vercel AI Gateway key in **Settings → Summary**
3. Start a quick note
4. Record microphone audio
5. If testing system audio, verify macOS **Audio Capture** permission is enabled
6. Stop the note and confirm:
   - transcript appears
   - notes save
   - summary can be generated
7. Open the homepage and test the bottom **Ask anything** panel

## Where To Find Build Info
Open **About** in the app to see the current channel and build ID.

## Sharing a build

See [Sharing Afterword](afterword-sharing.md) to package `Afterword.app` and send
it. Do not send `tauri dev` or API keys.

## Maintenance

See [Afterword maintenance](afterword-maintenance.md) for the fork policy and validation required before promoting changes.
