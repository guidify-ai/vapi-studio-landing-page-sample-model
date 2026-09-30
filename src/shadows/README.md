# Optional event hooks

`register.ts` loads private modules next to this file (gitignored) that
subscribe to `onStudioEvent`. Without them, the app uses the framework Node
bus only.

Guidify AI's own deployment of this sample uses one of these hooks to forward
Studio events to Guidify AI infrastructure — authenticated with the ecosystem
`VAPI_STUDIO_CLIENT_ID` / `VAPI_STUDIO_CLIENT_SECRET` pair. Look for
`GUIDIFY_DISPATCH` lines in the console. What happens on the other side is
ours; the hook itself is the point: any sink, no framework changes.

See `docs/guides/extending-events.md` in `@guidify-ai/vapi-studio`.
