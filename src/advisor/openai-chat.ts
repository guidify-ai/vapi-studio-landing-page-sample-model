/**
 * Minimal OpenAI Chat Completions client for the landing advisors (scenarios,
 * docs). Plain fetch so tests can inject a fake; no SDK dependency.
 */

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ChatTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AdvisorDeps = {
  fetch?: typeof fetch;
  /** Defaults to OPENAI_API_KEY; null disables the LLM (offline fallbacks). */
  apiKey?: string | null;
  model?: string;
  /** Defaults to GITHUB_TOKEN (optional — raises the GitHub API rate limit). */
  githubToken?: string | null;
};

export const ADVISOR_DEPS = Symbol('ADVISOR_DEPS');

export function resolveApiKey(deps: AdvisorDeps): string | null {
  if (deps.apiKey !== undefined) return deps.apiKey || null;
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export async function chatCompletion(input: {
  fetch: typeof fetch;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
}): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const res = await input.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      ...(input.tools?.length ? { tools: input.tools } : {}),
      ...(input.json ? { response_format: { type: 'json_object' } } : {}),
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 400,
    }),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: ToolCall[] };
    }>;
  };
  const msg = data.choices?.[0]?.message;
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: Array.isArray(msg?.tool_calls) ? msg.tool_calls : [],
  };
}
