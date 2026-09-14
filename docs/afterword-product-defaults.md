# Afterword product defaults

In this fork Afterword **is** the product. Meetily code stays in-tree; Afterword
builds must not drift onto Meetily's Groq-first defaults.

## Single sources

| Layer | Flag | Defaults |
| --- | --- | --- |
| Frontend | `NEXT_PUBLIC_FLAVOR=afterword` (`src/flavor/index.ts`) | `src/constants/modelDefaults.ts` — Parakeet STT + Gateway/Luna summaries |
| Native | Cargo feature `afterword` | `src-tauri/src/config.rs` feature-gated constants, applied by `afterword::defaults::apply_fresh_install_defaults` |

Do not add a third default. `config.rs` `DEFAULT_SUMMARY_MODEL` for Afterword
must match `AFTERWORD_GATEWAY_MODEL` / `openai/gpt-5.6-luna`. Fresh DB and
onboarding call `apply_fresh_install_defaults`; they do not write Groq or
`gpt-4o-mini`.

`pnpm tauri:dev:afterword` sets both the flavor env and the Cargo feature via
`scripts/tauri-auto.js` + `tauri.afterword.tester.conf.json`. Bundle id is
`com.afterword.app`.

Existing installs that already chose Groq are left alone; helpers only fill
missing/fresh config.
