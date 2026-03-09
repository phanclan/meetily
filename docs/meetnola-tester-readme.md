# Meetnola Tester README

## What This Is
`meetnola Tester.app` is a separate peer-test build of Meetnola for macOS.

- App name: `meetnola Tester`
- Bundle ID: `com.meetnola.tester`
- It is separate from the original `Meetily.app`

## If You Already Have Meetily
That is fine.

`meetnola Tester` does **not** overwrite the original Meetily app or its notes database.

- Original app data: `~/Library/Application Support/com.meetily.ai/`
- Tester app data: `~/Library/Application Support/com.meetnola.tester/`

The tester build can run side-by-side with the original app.

## First Run
On first launch, the app will:

1. Create its own clean app-data folder under `~/Library/Application Support/com.meetnola.tester/`
2. Start onboarding
3. Default both **Transcription** and **Summary** to **Groq**
4. Skip local model downloads during onboarding
5. Route you to **Settings -> Transcription** if no Groq API key is present

One Groq key is enough for both transcription and summary.

## What You Need To Do
1. Fix executable permissions if launch fails

   Some archive/unzip paths can strip execute permission from the bundled binaries inside the app.
   If launch fails with errors like `Launch failed`, `permission denied`, or error code `111`, run:

   ```bash
   chmod +x "meetnola Tester.app/Contents/MacOS/meetily" \
            "meetnola Tester.app/Contents/MacOS/ffmpeg" \
            "meetnola Tester.app/Contents/MacOS/llama-helper"
   ```

   Adjust the path if you moved the app, for example:
   `/Applications/meetnola Tester.app/Contents/MacOS/...`

2. Remove the quarantine flag

   Downloaded apps are often quarantined by macOS. Clear it with:

   ```bash
   xattr -r -d com.apple.quarantine "meetnola Tester.app"
   ```

3. Open the app

   Move `meetnola Tester.app` to **Applications** if you want.

   If macOS still blocks it:
   - right-click the app
   - click **Open**
   - confirm the security prompt

4. Grant permissions when prompted
   - **Microphone**
   - **Audio Capture** if you want system audio recording

5. Configure Groq
   - Open **Settings -> Transcription**
   - Paste a Groq API key

Groq’s free tier is enough for basic testing.

- Keys: `https://console.groq.com/keys`
- Pricing / free tier: `https://groq.com/pricing`

## Defaults
- Analytics: **off by default**
- Summary provider: **Groq**
- Transcript provider: **Groq**
- Local models: optional, not downloaded during onboarding

## Recordings Folder
New default recordings go to:

- macOS: `~/Movies/meetnola-recordings/`

If you used older internal builds that referenced `meetily-recordings`, the app will move the default path forward to `meetnola-recordings` for new saves.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Launch failed`, error `111`, or `permission denied` | Binaries inside the app bundle lost executable permission during extraction | Run `chmod +x` on all three binaries in `Contents/MacOS/` |
| `app is damaged` or Gatekeeper blocks launch | macOS quarantine attribute is still attached to the app | Run `xattr -r -d com.apple.quarantine "meetnola Tester.app"` |
| Security prompt will not go away | The app is ad-hoc signed and not trusted yet | Right-click the app, click **Open**, then confirm the dialog |

## Current Limitations
- The `.app` bundle works for testing.
- The `.dmg` packaging step is still not fixed in this branch.
- The app is ad-hoc signed, not notarized.
- Archive extraction may strip executable permissions from the bundled binaries. If that happens, use the `chmod +x` step above.

## Good Peer-Test Checks
1. Complete onboarding
2. Add a Groq key
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
