export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-boy-import-key, x-boy-pos-key",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

export function hasValidSharedKey(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < provided.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const payload = await request.json();
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("request body must be a JSON object");
  }
  return payload as Record<string, unknown>;
}
