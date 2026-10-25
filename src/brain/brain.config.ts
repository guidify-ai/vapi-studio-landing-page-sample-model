/**
 * Brain wiring for this app. Change here — not in .env.
 *
 * Live adapters (stock JSON-LLM; `model` is any id the provider accepts):
 * - studio-chatgpt → ChatGptBrainAdapter (OPENAI_API_KEY)
 * - studio-claude  → ClaudeBrainAdapter  (ANTHROPIC_API_KEY)
 * - studio-gemini  → GeminiBrainAdapter  (GOOGLE_API_KEY / GEMINI_API_KEY)
 * - studio-grok    → GrokBrainAdapter    (XAI_API_KEY)
 * - studio-openai-decisions → OpenAiDecisionsBrainAdapter (OPENAI_API_KEY):
 *   scores intentions with `decisions.model`; ChatGPT (`model` below) still does
 *   listen-field extraction and clarify. Every intention needs a description
 *   (config/flow.yaml `intentions`).
 *
 * Mock adapters (deterministic sequences; no provider network):
 * - mock | mock-chatgpt → MockChatGptBrainAdapter (alias: MockBrainAdapter)
 * - mock-claude         → MockClaudeBrainAdapter
 * - mock-gemini         → MockGeminiBrainAdapter
 * - mock-grok           → MockGrokBrainAdapter
 *
 * Default: live OpenAI Decisions (+ ChatGPT as brain.llm) when OPENAI_API_KEY is set,
 * otherwise mock-chatgpt. Set `studio-chatgpt` to scan with ChatGPT only.
 * `model` must belong to the selected live adapter's provider.
 * `providerOptions` go into the request body as-is — gpt-4.1-mini accepts
 * `temperature: 0`; gpt-6-luna rejects it (use `reasoning_effort` instead).
 */
export type SampleBrainAdapterId =
  | 'mock'
  | 'mock-chatgpt'
  | 'mock-claude'
  | 'mock-gemini'
  | 'mock-grok'
  | 'studio-chatgpt'
  | 'studio-claude'
  | 'studio-gemini'
  | 'studio-grok'
  | 'studio-openai-decisions';

export type SampleBrainModelId = string;

export const brainConfig = {
  adapter: (process.env.OPENAI_API_KEY
    ? 'studio-openai-decisions'
    : 'mock-chatgpt') as SampleBrainAdapterId,
  model: 'gpt-4.1-mini' as SampleBrainModelId,
  providerOptions: { temperature: 0 } as Record<string, unknown>,
  confidenceThreshold: 0.4,
  timeoutMs: 3_000,
  decisions: {
    model: 'gpt-6-luna' as SampleBrainModelId,
    timeoutMs: 1_500,
  },
};
