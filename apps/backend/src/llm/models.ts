import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/**
 * One language model behind a minimal interface: plain text, or a JSON object validated against a
 * Zod schema. Every failure throws (transport, rate limit, refusal, bad JSON), so callers decide
 * what to fall back to. Callers only ever send labels and numbers, never keys or addresses.
 */
export interface TextModel {
  readonly name: string;
  text(req: TextRequest): Promise<string>;
  json<T extends z.ZodType>(req: TextRequest & { schemaName: string; schema: T }): Promise<z.infer<T>>;
}

export interface TextRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export class ModelError extends Error {
  constructor(
    readonly model: string,
    readonly label: string,
  ) {
    super(`${model}: ${label}`);
  }
}

/** Short reason for a failed HTTP call, safe to store and show (no bodies, no keys). */
function httpLabel(status: number): string {
  if (status === 429) return "rate limited";
  if (status === 401 || status === 403) return "credentials rejected";
  if (status === 400 || status === 422) return "rejected the request";
  if (status >= 500) return `server error ${status}`;
  return `error ${status}`;
}

/** Models sometimes wrap JSON in a code fence even when asked not to. */
function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

/**
 * Any OpenAI-compatible chat completions endpoint. Google AI Studio (Gemini) and OpenRouter both
 * expose one, so a single client covers both with no extra dependency.
 */
export class OpenAICompatibleModel implements TextModel {
  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly headers: Record<string, string> = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async text(req: TextRequest): Promise<string> {
    const content = await this.complete(req);
    if (!content.trim()) throw new ModelError(this.name, "empty reply");
    return content.trim();
  }

  async json<T extends z.ZodType>(req: TextRequest & { schemaName: string; schema: T }): Promise<z.infer<T>> {
    const content = await this.complete(req, {
      type: "json_schema",
      json_schema: { name: req.schemaName, strict: true, schema: z.toJSONSchema(req.schema) },
    });
    let raw: unknown;
    try {
      raw = parseJsonText(content);
    } catch {
      throw new ModelError(this.name, "unparseable output");
    }
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new ModelError(this.name, "output did not match the schema");
    return parsed.data;
  }

  private async complete(req: TextRequest, responseFormat?: unknown): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, ...this.headers },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ModelError(this.name, (err as Error).name === "TimeoutError" ? "timed out" : "unreachable");
    }
    if (!res.ok) throw new ModelError(this.name, httpLabel(res.status));
    const body = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
    } | null;
    const choice = body?.choices?.[0];
    if (!choice?.message) throw new ModelError(this.name, "no choices in reply");
    if (choice.message.refusal) throw new ModelError(this.name, "declined");
    if (choice.finish_reason === "length") throw new ModelError(this.name, "ran out of tokens");
    return choice.message.content ?? "";
  }
}

/** Claude through the Anthropic SDK, kept for anyone who prefers it over the free providers. */
export class AnthropicModel implements TextModel {
  readonly name = "claude";

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async text(req: TextRequest): Promise<string> {
    const response = await this.call(() =>
      this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: req.user }],
          output_config: { effort: "low" },
        },
        { timeout: this.timeoutMs, maxRetries: 1 },
      ),
    );
    this.checkStop(response.stop_reason);
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join(" ")
      .trim();
    if (!text) throw new ModelError(this.name, "empty reply");
    return text;
  }

  async json<T extends z.ZodType>(req: TextRequest & { schemaName: string; schema: T }): Promise<z.infer<T>> {
    const response = await this.call(() =>
      this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: req.user }],
          output_config: { effort: "low", format: betaZodOutputFormat(req.schema) },
        },
        { timeout: this.timeoutMs, maxRetries: 1 },
      ),
    );
    this.checkStop(response.stop_reason);
    if (response.parsed_output == null) throw new ModelError(this.name, "unparseable output");
    return response.parsed_output as z.infer<T>;
  }

  private checkStop(stop: string | null): void {
    if (stop === "refusal") throw new ModelError(this.name, "declined");
    if (stop === "max_tokens") throw new ModelError(this.name, "ran out of tokens");
  }

  private async call<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn();
    } catch (err) {
      throw new ModelError(this.name, anthropicLabel(err));
    }
  }
}

function anthropicLabel(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "timed out";
  if (err instanceof Anthropic.RateLimitError) return "rate limited";
  if (err instanceof Anthropic.AuthenticationError) return "credentials rejected";
  if (err instanceof Anthropic.BadRequestError) return "rejected the request";
  if (err instanceof Anthropic.APIError) return `error ${err.status ?? ""}`.trim();
  return "unreachable";
}

/**
 * Tries each model in order and returns the first answer. Free tiers rate-limit often, so a second
 * provider keeps Chogs talking; when every model fails, the caller falls back to its template.
 */
export class ModelChain implements TextModel {
  readonly name: string;

  constructor(private readonly models: TextModel[]) {
    if (models.length === 0) throw new Error("ModelChain needs at least one model");
    this.name = models.map((m) => m.name).join(" > ");
  }

  text(req: TextRequest): Promise<string> {
    return this.first((m) => m.text(req));
  }

  json<T extends z.ZodType>(req: TextRequest & { schemaName: string; schema: T }): Promise<z.infer<T>> {
    return this.first((m) => m.json(req));
  }

  private async first<R>(fn: (m: TextModel) => Promise<R>): Promise<R> {
    const failures: string[] = [];
    for (const m of this.models) {
      try {
        return await fn(m);
      } catch (err) {
        failures.push(err instanceof ModelError ? err.message : `${m.name}: unavailable`);
      }
    }
    throw new ModelError(this.name, failures.join("; "));
  }
}
