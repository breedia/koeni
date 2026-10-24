// KOESELL paid-order delivery. No public master-audio URLs.
// Inactive for sales until Checkout and verified payment webhooks are configured.
// Server authorization: buyer must own a paid, non-refunded order.
import { createClient } from "npm:@supabase/supabase-js@2";

const LEGACY_SITE = "https://koeni.pages.dev";
const ALLOWED_SITES = new Set([LEGACY_SITE,"https://koesell.com","https://www.koesell.com"]);
const env = (name: string) => Deno.env.get(name) || "";
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_SITES.has(origin) ? origin : LEGACY_SITE,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (obj: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
const secret = () => {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(env("SUPABASE_SECRET_KEYS"));
    return keys?.default || "";
  } catch { return ""; }
};
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (origin && !ALLOWED_SITES.has(origin)) return json({ error: "origin_not_allowed" }, 403, origin);
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "login_required" }, 401, origin);
  const adminKey = secret();
  const url = env("SUPABASE_URL");
  if (!adminKey || !url) return json({ error: "server_not_configured" }, 503, origin);
  const db = createClient(url, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    const { data: session, error: authError } = await db.auth.getUser(token);
    if (authError || !session?.user) return json({ error: "login_required" }, 401, origin);
    const raw = await req.json();
    const orderId = typeof raw?.orderId === "string" ? raw.orderId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return json({ error: "invalid_order" }, 400, origin);
    }
    const { data: order, error } = await db.from("voice_orders")
      .select("id,buyer_id,status,purchased_master_path")
      .eq("id", orderId).maybeSingle();
    if (error) throw error;
    if (!order || order.buyer_id !== session.user.id) return json({ error: "not_found" }, 404, origin);
    if (order.status !== "paid") return json({ error: "order_not_downloadable" }, 403, origin);
    const signed = await db.storage.from("koesell-masters").createSignedUrl(order.purchased_master_path, 60);
    if (signed.error || !signed.data?.signedUrl) throw signed.error || Error("no_signed_url");
    return json({ url: signed.data.signedUrl, expiresInSeconds: 60 }, 200, origin);
  } catch (error) {
    console.error("KOESELL delivery error", error instanceof Error ? error.message : "unknown");
    return json({ error: "delivery_unavailable" }, 500, origin);
  }
});
