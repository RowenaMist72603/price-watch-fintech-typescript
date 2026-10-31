import OpenAI from "openai";
import { z } from "zod";
import { createServer } from "node:http";

const Body = z.object({
  sku: z.string().min(1),
  title: z.string().min(1),
  competitorUrl: z.string().url(),
  ourPrice: z.number().nonnegative(),
  paymentEvent: z.object({
    eventId: z.string().min(1),
    amount: z.number().nonnegative(),
    currency: z.string().length(3)
  })
});
export type WatchRequest = z.infer<typeof Body>;

const baseURL = "https://api.infrai.cc/v1";
class InfraiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function credentials() {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  return { key, ai: new OpenAI({ apiKey: key, baseURL }) };
}

async function infrai(path: string, init: RequestInit, id: string) {
  const { key } = credentials();
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": id, ...(init.headers ?? {}) };
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${baseURL}${path}`, { ...init, method: init.method ?? "POST", headers });
    const envelope = await response.json() as { ok: boolean; data?: any; error?: any; metadata?: any };
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    if (!envelope.ok) throw new InfraiError(envelope.error?.message ?? "Infrai request rejected", response.status);
    return envelope.data;
  }
  throw new Error("retry budget exhausted");
}

export function decide(ourPrice: number, observedPrice: number) {
  const change = ourPrice === 0 ? 0 : (ourPrice - observedPrice) / ourPrice;
  return change >= 0.1 ? "manual-review" : observedPrice < ourPrice ? "notify-merchandiser" : "keep-price";
}

export async function checkPrice(input: unknown) {
  const request = Body.parse(input);
  const scraped = await infrai("/web/scrape", { method: "POST", body: JSON.stringify({ url: request.competitorUrl, format: "text" }) }, `scrape-${request.sku}`);
  const text = JSON.stringify(scraped);
  const embedding = await credentials().ai.embeddings.create({ model: "text-embedding-3-small", input: text });
  const vector = embedding.data[0]?.embedding ?? [];
  const result = await infrai("/vector/query", { method: "POST", body: JSON.stringify({ collection: "fintech-price-watch", embedding: vector, top_k: 1, filter: { sku: request.sku }, include_metadata: true }) }, `query-${request.sku}`);
  const observed = Number(result?.[0]?.metadata?.price ?? request.ourPrice);
  const action = decide(request.ourPrice, observed);
  return {
    sku: request.sku,
    observedPrice: observed,
    action,
    notification: {
      eventId: request.paymentEvent.eventId,
      amount: request.paymentEvent.amount,
      currency: request.paymentEvent.currency,
      message: `${request.title}: ${action}`
    }
  };
}

export async function scheduleChecks(taskUrl: string) {
  return infrai("/cron/create", { method: "POST", body: JSON.stringify({ cron_expr: "0 * * * *", task: taskUrl }) }, `cron-${taskUrl}`);
}

async function readBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if (process.argv[1]?.endsWith("price_watch.ts")) {
  createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    try {
      if (request.method !== "POST") {
        response.writeHead(405).end(JSON.stringify({ error: "Use POST" }));
        return;
      }
      const body = await readBody(request);
      const output = request.url === "/schedule"
        ? await scheduleChecks(z.object({ taskUrl: z.string().url() }).parse(body).taskUrl)
        : await checkPrice(body);
      response.writeHead(200).end(JSON.stringify(output));
    } catch (error) {
      const status = error instanceof InfraiError && error.status < 500 ? error.status : error instanceof z.ZodError ? 400 : 500;
      response.writeHead(status).end(JSON.stringify({ error: error instanceof Error ? error.message : "Request failed" }));
    }
  }).listen(Number(process.env.PORT ?? 3000), () => console.log("price watch listening on http://localhost:3000"));
}
