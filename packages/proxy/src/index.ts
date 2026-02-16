import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

const app = new Hono();

app.use("*", cors());

const TARGETS: Record<string, string> = {
  "/gamma": "https://gamma-api.polymarket.com",
  "/clob": "https://clob.polymarket.com",
};

// Proxy: /gamma/markets → https://gamma-api.polymarket.com/markets
// Proxy: /clob/prices-history → https://clob.polymarket.com/prices-history
app.all("/gamma/*", proxyTo("/gamma", TARGETS["/gamma"]));
app.all("/clob/*", proxyTo("/clob", TARGETS["/clob"]));

app.get("/health", (c) => c.json({ ok: true }));

function proxyTo(prefix: string, target: string) {
  return async (c: any) => {
    const path = c.req.path.replace(prefix, "");
    const url = new URL(path, target);
    url.search = new URL(c.req.url).search;

    const res = await fetch(url.toString(), {
      method: c.req.method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
    });
  };
}

const PORT = 3001;
console.log(`Proxy listening on http://localhost:${PORT}`);
serve({ fetch: app.fetch, port: PORT });
