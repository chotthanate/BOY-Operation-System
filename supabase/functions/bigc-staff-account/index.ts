import { createClient } from "npm:@supabase/supabase-js@2.106.2";

const headers = { "Content-Type": "application/json" };
Deno.serve(async (request: Request) => {
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (request.method !== "POST") return respond({ error: "POST required" }, 405);
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "authentication required" }, 401);
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: actor, error: actorError } = await service.auth.getUser(authorization.slice(7));
  if (actorError || !actor.user) return respond({ error: "authentication required" }, 401);
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: profile } = await caller.schema("boy_central").from("profiles")
    .select("company_role,active").eq("user_id", actor.user.id).maybeSingle();
  if (!profile?.active || profile.company_role !== "admin") return respond({ error: "admin required" }, 403);
  try {
    const { pin } = await request.json();
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return respond({ error: "six digit PIN required" }, 400);
    const staffEmail = "bigc-staff@boy-operation-system.local";
    const { data: existing, error: lookupError } = await caller.schema("boy_central").from("profiles")
      .select("user_id,company_role").eq("employee_code", "BIGC-SHARED-STAFF").maybeSingle();
    if (lookupError) throw lookupError;
    if (existing && existing.company_role !== "staff") return respond({ error: "dedicated staff account required" }, 409);
    let userId = existing?.user_id;
    if (userId) {
      const { error } = await service.auth.admin.updateUserById(userId, { password: pin, email_confirm: true });
      if (error) throw error;
    } else {
      const { data, error } = await service.auth.admin.createUser({
        email: staffEmail, password: pin, email_confirm: true,
        app_metadata: { account_purpose: "bigc_shared_staff" }
      });
      if (error) throw error;
      userId = data.user.id;
    }
    const { error } = await service.schema("boy_central").rpc("configure_bigc_staff_account", {
      actor_user_id: actor.user.id, target_user_id: userId
    });
    if (error) throw error;
    return respond({ status: "configured", user_id: userId });
  } catch (_) {
    // Do not include request bodies, credentials or Auth errors in responses.
    return respond({ error: "staff account configuration failed" }, 400);
  }
});
