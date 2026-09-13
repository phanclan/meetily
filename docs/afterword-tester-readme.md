# Afterword Tester README

## What This Is
`Afterword.app` is a separate peer-test build of Afterword for macOS. (Afterword was
previously called Meetnola.)

- App name: `Afterword`
- Bundle ID: `com.meetnola.tester` — kept from the Meetnola name so existing app data and macOS permission grants survive the rename
- It is separate from the original `Meetily.app`

## If You Already Have Meetily
That is fine.

`Afterword` does **not** overwrite the original Meetily app or its notes database.

- Original app data: `~/Library/Application Support/com.meetily.ai/`
- Tester app data: `~/Library/Application Support/com.meetnola.tester/`

The tester build can run side-by-side with the original app.

## First Run
On first launch, the app will:

1. Create its own clean app-data folder under `~/Library/Application Support/com.meetnola.tester/`
2. Start onboarding
3. Default **Transcription** to local **Parakeet** (Whisper also available)
4. Default **Summary / Enhance** to **Vercel AI Gateway** via Custom OpenAI (`https://ai-gateway.vercel.sh/v1`, model `openai/gpt-5.6-luna`)
5. Skip local model downloads during onboarding (download Parakeet later from Settings)
6. Route you to **Settings → Summary** if no Gateway API key is present

Recording works without a Gateway key. Summaries/Enhance need your Gateway API key (never baked into the build).
Existing installs retain their settings and keys, but this recovery baseline supports local transcription only. If an existing install has Groq selected for transcription, choose **Parakeet** or **Local Whisper** and download a model before recording. Groq summary settings are separate.

## What You Need To Do
1. Fix executable permissions if launch fails

   Some archive/unzip paths can strip execute permission from the bundled binaries inside the app.
   If launch fails with errors like `Launch failed`, `permission denied`, or error code `111`, run:

   ```bash
   chmod +x "Afterword.app/Contents/MacOS/meetily" \
            "Afterword.app/Contents/MacOS/ffmpeg" \
            "Afterword.app/Contents/MacOS/llama-helper"
   ```

   Adjust the path if you moved the app, for example:
   `/Applications/Afterword.app/Contents/MacOS/...`

2. Remove the quarantine flag

   Downloaded apps are often quarantined by macOS. Clear it with:

   ```bash
   xattr -r -d com.apple.quarantine "Afterword.app"
   ```

3. Open the app

   Move `Afterword.app` to **Applications** if you want.

   If macOS still blocks it:
   - right-click the app
   - click **Open**
   - confirm the security prompt

4. Grant permissions when prompted
   - **Microphone**
   - **Audio Capture** if you want system audio recording

5. Configure Vercel AI Gateway (summaries)
   - Open **Settings -> Transcription**
   - Open Settings → Summary, choose Custom Server / AI Gateway (or apply the Gateway preset), paste your Gateway API key

Groq’s free tier is enough for basic testing.

- Keys: `https://console.groq.com/keys`
- Pricing / free tier: `https://groq.com/pricing`

## Defaults
- Analytics: **off by default**
- Summary provider: **custom-openai** → Vercel AI Gateway (`openai/gpt-5.6-luna`)
- Transcript provider: **parakeet** (local)
- Local STT models: optional download after onboarding
- Gateway API key: required only for summaries/Enhance

## Recordings Folder
New default recordings go to:

- macOS: `~/Movies/meetily-recordings/`

This is the path the app actually uses (`audio/recording_preferences.rs`); it was not
renamed alongside the product name.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Launch failed`, error `111`, or `permission denied` | Binaries inside the app bundle lost executable permission during extraction | Run `chmod +x` on all three binaries in `Contents/MacOS/` |
| `app is damaged` or Gatekeeper blocks launch | macOS quarantine attribute is still attached to the app | Run `xattr -r -d com.apple.quarantine "Afterword.app"` |
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

## Maintenance

See [Afterword maintenance](afterword-maintenance.md) for the fork policy and validation required before promoting changes.
