// supabase/functions/mp-create-preference/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN");
    if (!MP_ACCESS_TOKEN) {
      return json({ error: "Missing MP_ACCESS_TOKEN (Secrets)" }, 500);
    }

    const body = await req.json().catch(() => ({}));

    const order_id = body?.order_id as string | undefined;
    const total_cents = Number(body?.total_cents);
    const base_url = (body?.base_url as string | undefined) || "";
    const notification_url = body?.notification_url as string | undefined;
    const mode = (body?.mode as string | undefined) || "test";

    if (!order_id) return json({ error: "order_id obrigatório" }, 400);
    if (!Number.isFinite(total_cents) || total_cents <= 0) {
      return json({ error: "total_cents inválido" }, 400);
    }
    if (!base_url) return json({ error: "base_url obrigatório" }, 400);

    // ✅ garante que base_url não termina com /
    const baseUrl = base_url.replace(/\/+$/, "");

    // ✅ sempre voltar para pedido.html (e não checkout)
    const successUrl = `${baseUrl}/pedido.html?status=success&order_id=${order_id}`;
    const pendingUrl = `${baseUrl}/pedido.html?status=pending&order_id=${order_id}`;
    const failureUrl = `${baseUrl}/pedido.html?status=failure&order_id=${order_id}`;

    // ✅ preço em reais para o MP (unit_price é number em BRL)
    const unit_price = Number((total_cents / 100).toFixed(2));

    const preferencePayload: Record<string, unknown> = {
      items: [
        {
          title: `Pedido ${order_id}`,
          quantity: 1,
          currency_id: "BRL",
          unit_price,
        },
      ],
      external_reference: order_id,
      notification_url: notification_url || undefined,
      back_urls: {
        success: successUrl,
        pending: pendingUrl,
        failure: failureUrl,
      },
    };

    // ✅ auto_return só em https (em localhost costuma não voltar sozinho)
    if (baseUrl.startsWith("https://")) {
      preferencePayload.auto_return = "approved";
    }

    const mpRes = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(preferencePayload),
      },
    );

    const mpData = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok) {
      return json(
        { error: "Mercado Pago error", status: mpRes.status, details: mpData, sent: preferencePayload },
        400,
      );
    }

    return json({
      ok: true,
      preference_id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
      mode,
      external_reference: order_id,
      back_urls: preferencePayload.back_urls,
    });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
