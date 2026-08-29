import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, hasValidSharedKey, jsonResponse, readJsonObject } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const expectedKey = Deno.env.get("BOY_IMPORT_SHARED_SECRET");
  if (!hasValidSharedKey(request.headers.get("x-boy-import-key"), expectedKey)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const payload = await readJsonObject(request);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "server_not_configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.schema("boy_central").rpc("upsert_import_batch", { payload });
    if (error) {
      console.error("sheet import failed", error.code, error.message);
      return jsonResponse({ error: "import_failed", message: error.message }, 400);
    }

    return jsonResponse(data, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    return jsonResponse({ error: "invalid_request", message }, 400);
  }
});
