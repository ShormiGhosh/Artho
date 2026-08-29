import { env, aiConfigured } from '../../config/env';
import { logger } from '../../utils/logger';

/**
 * Minimal, dependency-free OpenAI Chat Completions client.
 *
 * - Talks only to the configured base URL with the server-side API key.
 * - Forces JSON output (`response_format: json_object`) so callers never parse
 *   arbitrary prose.
 * - Hard timeout via AbortController; bounded retry with backoff on 429 / 5xx /
 *   network errors.
 * - Never logs the API key, the prompt, or the completion text — only the model
 *   name, duration, token counts and an outcome code.
 */

export type AIErrorCode =
  | 'AI_DISABLED' // no API key configured
  | 'AI_TIMEOUT' // request exceeded OPENAI_TIMEOUT_MS
  | 'AI_RATE_LIMITED' // 429 after retries
  | 'AI_UPSTREAM' // non-2xx from OpenAI after retries
  | 'AI_NETWORK' // fetch/connection failure after retries
  | 'AI_BAD_OUTPUT'; // response was not usable JSON

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly retryable: boolean;
  constructor(code: AIErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface ChatJsonResult {
  /** Parsed JSON object from the model. Shape is validated by the caller. */
  json: Record<string, unknown>;
  model: string;
  usage: ChatUsage;
  duration_ms: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isEnabled(): boolean {
  return aiConfigured();
}

/**
 * One structured JSON completion.
 *
 * @throws {AIError} on any failure — callers are expected to catch and fall back
 *   to a deterministic result so the core product keeps working.
 */
export async function chatJson(opts: {
  system: string;
  user: string;
  /** Upper bound on completion size; keeps latency and cost predictable. */
  maxTokens?: number;
  /** Overrides the configured model (tests / experiments). */
  model?: string;
}): Promise<ChatJsonResult> {
  if (!isEnabled()) {
    throw new AIError('AI_DISABLED', 'OpenAI API key is not configured');
  }

  const apiKey = (process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? '').trim();
  const model = opts.model ?? env.OPENAI_MODEL;
  const url = `${env.OPENAI_BASE_URL}/chat/completions`;
  const body = JSON.stringify({
    model,
    temperature: 0,
    max_tokens: opts.maxTokens ?? 700,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  });

  const maxAttempts = Math.max(1, env.OPENAI_MAX_RETRIES + 1);
  const started = Date.now();
  let lastErr: AIError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.OPENAI_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: controller.signal,
      });

      if (res.status === 429) {
        lastErr = new AIError('AI_RATE_LIMITED', 'OpenAI rate limited', true);
      } else if (res.status >= 500) {
        lastErr = new AIError('AI_UPSTREAM', `OpenAI ${res.status}`, true);
      } else if (!res.ok) {
        // 4xx (bad request, auth, quota) — not retryable.
        throw new AIError('AI_UPSTREAM', `OpenAI ${res.status}`, false);
      } else {
        const payload = (await res.json()) as any;
        const content: string | undefined = payload?.choices?.[0]?.message?.content;
        if (!content) throw new AIError('AI_BAD_OUTPUT', 'Empty completion');
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(content);
        } catch {
          throw new AIError('AI_BAD_OUTPUT', 'Completion was not valid JSON');
        }
        if (json === null || typeof json !== 'object' || Array.isArray(json)) {
          throw new AIError('AI_BAD_OUTPUT', 'Completion was not a JSON object');
        }
        const duration_ms = Date.now() - started;
        logger.info('ai call ok', {
          model,
          attempt,
          duration_ms,
          prompt_tokens: payload?.usage?.prompt_tokens,
          completion_tokens: payload?.usage?.completion_tokens,
        });
        return {
          json,
          model,
          usage: {
            prompt_tokens: payload?.usage?.prompt_tokens,
            completion_tokens: payload?.usage?.completion_tokens,
          },
          duration_ms,
        };
      }
    } catch (err) {
      if (err instanceof AIError) {
        if (!err.retryable) throw err;
        lastErr = err;
      } else if ((err as Error)?.name === 'AbortError') {
        lastErr = new AIError('AI_TIMEOUT', 'OpenAI request timed out', true);
      } else {
        lastErr = new AIError('AI_NETWORK', `OpenAI request failed: ${(err as Error)?.message}`, true);
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < maxAttempts) {
      await sleep(300 * 2 ** (attempt - 1) + Math.floor(Math.random() * 120));
    }
  }

  logger.warn('ai call failed after retries', {
    model,
    attempts: maxAttempts,
    code: lastErr?.code,
  });
  throw lastErr ?? new AIError('AI_NETWORK', 'OpenAI request failed');
}
