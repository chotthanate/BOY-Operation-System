import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, hasValidSharedKey, jsonResponse, readJsonObject } from "../_shared/http.ts";

type SyncRequest = Record<string, unknown> & {
  event_type?: "order" | "void";
  payload?: Record<string, unknown>;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const expectedKey = Deno.env.get("BOY_POS_SYNC_SHARED_SECRET");
  if (!hasValidSharedKey(request.headers.get("x-boy-pos-key"), expectedKey)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const body = await readJsonObject(request) as SyncRequest;
    const eventType = body.event_type;
    if (eventType !== "order" && eventType !== "void") {
      return jsonResponse({ error: "invalid_event_type" }, 400);
    }
    if (!body.payload || Array.isArray(body.payload) || typeof body.payload !== "object") {
      return jsonResponse({ error: "invalid_payload" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "server_not_configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const functionName = eventType === "order" ? "ingest_pos_order" : "ingest_pos_void";
    const { data, error } = await supabase.rpc(functionName, { payload: body.payload });
    if (error) {
      console.error("POS shadow sync failed", error.code, error.message);
      return jsonResponse({ error: "sync_failed", message: error.message }, 400);
    }

    return jsonResponse(data, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    return jsonResponse({ error: "invalid_request", message }, 400);
  }
});
