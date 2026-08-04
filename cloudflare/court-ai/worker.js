const MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const IMAGE_PREFIX = "data:image/webp;base64,";

function json(status, body) {
  return Response.json(body, { status });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    if (!env.CRON_SECRET) return json(503, { success: false });
    if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
      return json(401, { success: false });
    }

    const input = await request.json().catch(() => null);
    if (
      input?.task !== "query"
      || typeof input.image !== "string"
      || !input.image.startsWith(IMAGE_PREFIX)
      || input.image.length > 500_000
      || typeof input.question !== "string"
      || input.question.length > 1_000
    ) {
      return json(400, { success: false });
    }

    try {
      const output = await env.AI.run(MODEL, {
        task: "query",
        image: input.image,
        question: input.question,
        reasoning: false,
        stream: false,
        temperature: 0,
        max_tokens: 64,
      });
      return json(200, {
        success: true,
        result: output?.result ?? output,
        usage: output?.usage ?? output?.metrics ?? null,
      });
    } catch {
      return json(502, { success: false });
    }
  },
};
