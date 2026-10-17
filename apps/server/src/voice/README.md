# Voice adapter integration

The voice lane exports `createVoiceModule(runtime, options?)`, `createVoiceHandlers(voice)`, and `voiceUnavailable` from `index.ts`.

- `createVoiceModule` takes a `VoiceRuntime` with `getCurrent(): { runId, announcements }`. It uses server-only `ELEVENLABS_API_KEY` for realtime STT token creation and TTS, and `ELEVENLABS_VOICE_ID` for speech synthesis. Missing configuration leaves voice unavailable; typed operator input remains separate.
- `createVoiceHandlers(voice)` returns native Node handlers `token(req: IncomingMessage, res: ServerResponse)` and `audio(req: IncomingMessage, res: ServerResponse)`. Register these at `GET /api/voice/token` and `POST /api/voice/audio` in the route composition layer. Do not expose the provider key.
- Audio requests contain only `{ announcementId }`. The runtime resolver must return only current-run, approved announcements from the local orchestrator. The adapter checks run ID and expiry before and after TTS synthesis. Operator replies should be represented by approved entries in `OperatorResponse.announcements`; arbitrary response text is not synthesized.
- The browser submits committed speech through the existing `onCommittedInput` callback. It does not create a second orchestration path. STT uses an ElevenLabs single-use realtime token; token lifetime is 15 minutes.

The adapter does not register routes, construct a runtime, or claim that preview-mode operator input is available. Validate provider credentials and browser microphone/audio permissions in the integrated app.
