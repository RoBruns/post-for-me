import { createHash, randomBytes, randomUUID } from "node:crypto";

export const SELF_HOSTED = process.env.SELF_HOSTED === "true";

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export async function createSelfHostedApiKey({
  supabaseServiceRole,
  projectId,
  teamId,
  createdBy,
  temporary = false,
}: {
  // This helper intentionally uses the service-role client. The local key table
  // has RLS enabled and is never exposed directly to browser clients.
  supabaseServiceRole: any;
  projectId: string;
  teamId: string;
  createdBy: string;
  temporary?: boolean;
}) {
  const prefix = temporary ? "pfm_tmp" : "pfm_live";
  const rawKey = `${prefix}_${randomBytes(32).toString("base64url")}`;
  const id = `key_${randomUUID()}`;
  const expiresAt = temporary
    ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { error } = await supabaseServiceRole
    .from("self_hosted_api_keys")
    .insert({
      id,
      project_id: projectId,
      team_id: teamId,
      created_by: createdBy,
      key_hash: hashApiKey(rawKey),
      key_prefix: rawKey.slice(0, temporary ? 16 : 17),
      name: temporary ? "TMP API Key" : "API Key",
      enabled: true,
      expires_at: expiresAt,
    });

  if (error) {
    throw new Error(error.message);
  }

  return { id, key: rawKey, expiresAt };
}

export async function verifySelfHostedApiKey({
  supabaseServiceRole,
  apiKey,
  projectId,
}: {
  supabaseServiceRole: any;
  apiKey: string;
  projectId?: string;
}) {
  let query = supabaseServiceRole
    .from("self_hosted_api_keys")
    .select("id, project_id, team_id, created_by, enabled, expires_at")
    .eq("key_hash", hashApiKey(apiKey))
    .eq("enabled", true);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    return null;
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return data as {
    id: string;
    project_id: string;
    team_id: string;
    created_by: string;
    enabled: boolean;
    expires_at: string | null;
  };
}
