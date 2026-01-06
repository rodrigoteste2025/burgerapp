// supabase/functions/mp-webhook/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapMpStatus(mpStatus: string | null | undefined) {
  const s = (mpStatus || "").toLowerCase();

  // MP: approved | pending | rejected | cancelled | in_process | refunded | charged_back
  if (s === "approved") return { payment_status: "paid", status: "preparando" };
  if (s === "rejected") return { payment_status: "rejected", status: "cancelado" };
  if (s === "cancelled") return { payment_status: "cancelled", status: "cancelado" };
  if (s === "refunded" || s === "charged_back") return { payment_status: "refunded", status: "cancelado" };

  // pending / in_process / etc
  return { payment_status: "pending", status: "novo" };
}

async function getPaymentId(req: Request) {
  // MP pode mandar payment_id em query:
  const url = new URL(req.url);
  const qId = url.searchParams.get("id") || url.searchParams.get("data.id");
  if (qId) return qId;

  // ou no body:
  const raw = await req.text().catch(() => "");
  if (!raw) return null;

  try {
    const body = JSON.parse(raw);

    // formatos comuns
    if (body?.data?.id) return String(body.data.id);
    if (body?.id) return String(body.id);

    // alguns envios usam resource com .../payments/{id}
    const resource: string | undefined = body?.resource;
    if (resource && resource.includes("/payments/")) {
      return resource.split("/payments/")[1]?.split("?")[0] || null;
    }

    // fallback: tentar achar número no texto
    const m = raw.match(/"id"\s*:\s*"?(\d+)"?/);
    if (m?.[1]) return m[1];
  } catch {
    // body não era JSON
    const m = raw.match(/"id"\s*:\s*"?(\d+)"?/);
    if (m?.[1]) return m[1];
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY =
    Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN");

  if (!SUPABASE_URL) return json({ error: "Missing SUPABASE_URL (Secrets)" }, 500);
  if (!SERVICE_ROLE_KEY) return json({ error: "Missing SERVICE_ROLE_KEY (Secrets)" }, 500);
  if (!MP_ACCESS_TOKEN) return json({ error: "Missing MP_ACCESS_TOKEN (Secrets)" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const paymentId = await getPaymentId(req);
  if (!paymentId) {
    // Importante: responder 200 mesmo assim pra não ficar tentando infinitamente
    return json({ ok: true, warning: "No payment id found" }, 200);
  }

  // 1) buscar pagamento no MP
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });

  const mpData = await mpRes.json().catch(() => ({}));

  if (!mpRes.ok) {
    // responder 200 para o MP não ficar re-tentando sem parar
    return json({ ok: true, warning: "Could not fetch payment", mp_error: mpData }, 200);
  }

  // 2) external_reference = order_id (UUID)
  const orderId = mpData?.external_reference ? String(mpData.external_reference) : null;
  const mpStatus = mpData?.status ? String(mpData.status) : null;

  if (!orderId) {
    return json({ ok: true, warning: "Missing external_reference on payment", mp_status: mpStatus }, 200);
  }

  const mapped = mapMpStatus(mpStatus);

  // 3) atualizar pedido no banco
  const { error: updErr } = await supabase
    .from("orders")
    .update({
      payment_provider: "mercadopago",
      payment_status: mapped.payment_status,
      status: mapped.status,
      // se você tiver colunas extras, pode guardar:
      // mp_payment_id: paymentId,
      // mp_status: mpStatus,
      // mp_raw: mpData,
    })
    .eq("id", orderId);

  if (updErr) {
    return json({ ok: true, warning: "Failed updating order", details: updErr.message }, 200);
  }

  return json({
    ok: true,
    order_id: orderId,
    payment_id: paymentId,
    mp_status: mpStatus,
    updated: mapped,
  });
});
