import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ModelChain, ModelError, OpenAICompatibleModel, type TextModel } from "../src/llm/models.js";

const Choice = z.object({ candidateId: z.enum(["rest", "quest-0"]), thought: z.string() });
const req = { system: "sys", user: "situation", maxTokens: 100, schemaName: "choice", schema: Choice };

function reply(content: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop", ...extra }] }), { status: 200 });
}

function model(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): OpenAICompatibleModel {
  return new OpenAICompatibleModel("gemini", "https://example.test/v1/", "secret-key", "flash", 1_000, { "X-Title": "CHOG World" }, fetchImpl as typeof fetch);
}

describe("OpenAICompatibleModel", () => {
  it("sends an OpenAI-style request with a JSON schema and returns the validated object", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const m = model(async (u, i) => {
      url = u;
      init = i;
      return reply('{"candidateId":"quest-0","thought":"Slime again."}');
    });
    await expect(m.json(req)).resolves.toEqual({ candidateId: "quest-0", thought: "Slime again." });
    expect(url).toBe("https://example.test/v1/chat/completions");
    const headers = init!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret-key");
    expect(headers["X-Title"]).toBe("CHOG World");
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("flash");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "situation" },
    ]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.schema.properties.candidateId.enum).toEqual(["rest", "quest-0"]);
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const m = model(async () => reply('```json\n{"candidateId":"rest","thought":"Nap."}\n```'));
    await expect(m.json(req)).resolves.toEqual({ candidateId: "rest", thought: "Nap." });
  });

  it("finds the JSON object in a reply that wraps it in prose", async () => {
    const m = model(async () => reply('Sure! Here is my choice: {"candidateId":"quest-0","thought":"Slime time."} Hope that helps.'));
    await expect(m.json(req)).resolves.toEqual({ candidateId: "quest-0", thought: "Slime time." });
  });

  it("adds provider routing fields only to structured requests", async () => {
    const bodies: Record<string, unknown>[] = [];
    const m = new OpenAICompatibleModel("openrouter", "https://example.test", "k", "openrouter/free", 1_000, {}, (async (_u: string, i: RequestInit) => {
      bodies.push(JSON.parse(i.body as string));
      return reply('{"candidateId":"rest","thought":"Nap."}');
    }) as typeof fetch, { provider: { require_parameters: true } });
    await m.json(req);
    await m.text(req);
    expect(bodies[0]!.provider).toEqual({ require_parameters: true });
    expect(bodies[1]!.provider).toBeUndefined();
  });

  it("turns every failure into a short, key-free reason", async () => {
    const cases: [() => Promise<Response>, string][] = [
      [async () => new Response("slow down", { status: 429 }), "rate limited"],
      [async () => new Response("bad key secret-key", { status: 401 }), "credentials rejected"],
      [async () => new Response("", { status: 503 }), "server error 503"],
      [async () => reply("not json"), "unparseable output"],
      [async () => reply('{"candidateId":"attack-1","thought":"x"}'), "output did not match the schema"],
      [async () => reply("", { finish_reason: "length" }), "ran out of tokens"],
      [async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, "timed out"],
      [async () => { throw new Error("ECONNREFUSED"); }, "unreachable"],
    ];
    for (const [behaviour, label] of cases) {
      const err = await model(behaviour).json(req).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ModelError);
      expect((err as ModelError).label).toBe(label);
      expect((err as ModelError).message).not.toContain("secret-key");
    }
  });

  it("returns trimmed plain text and rejects an empty reply", async () => {
    await expect(model(async () => reply("  I won twice.  ")).text(req)).resolves.toBe("I won twice.");
    await expect(model(async () => reply("   ")).text(req)).rejects.toThrow("empty reply");
  });
});

describe("ModelChain", () => {
  const failing = (name: string, label: string): TextModel => ({
    name,
    text: async () => { throw new ModelError(name, label); },
    json: async () => { throw new ModelError(name, label); },
  });
  const working = (name: string): TextModel => ({ name, text: async () => `${name} says hi`, json: async () => ({ by: name }) as never });

  it("answers from the first model that works", async () => {
    const chain = new ModelChain([failing("gemini", "rate limited"), working("openrouter"), working("claude")]);
    expect(chain.name).toBe("gemini > openrouter > claude");
    await expect(chain.text(req)).resolves.toBe("openrouter says hi");
    await expect(chain.json(req)).resolves.toEqual({ by: "openrouter" });
  });

  it("reports why each model failed when none works", async () => {
    const chain = new ModelChain([failing("gemini", "rate limited"), failing("openrouter", "timed out")]);
    const err = (await chain.text(req).catch((e: unknown) => e)) as ModelError;
    expect(err.label).toBe("gemini: rate limited; openrouter: timed out");
  });
});
