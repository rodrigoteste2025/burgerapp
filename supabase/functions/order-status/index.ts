// supabase/functions/order-status/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL) return json({ error: "Missing SUPABASE_URL (Secrets)" }, 500);
  if (!SERVICE_ROLE_KEY) return json({ error: "Missing SERVICE_ROLE_KEY (Secrets)" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const url = new URL(req.url);
  const order_id = url.searchParams.get("order_id");

  if (!order_id) return json({ error: "order_id é obrigatório" }, 400);

  // Busca pedido
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, payment_status, store_id, created_at, total_cents, pay_on_delivery, cash_change_cents")
    .eq("id", order_id)
    .single();

  if (error) return json({ error: "Pedido não encontrado", details: error.message }, 404);

 return json({
  ok: true,
  order_id: order.id,
  payment_status: order.payment_status || "pending",
  status: order.status || "novo",
  total_cents: order.total_cents,
  created_at: order.created_at,
  pay_on_delivery: order.pay_on_delivery === true,
  change_for_cents: order.change_for_cents ?? null,
});

});
