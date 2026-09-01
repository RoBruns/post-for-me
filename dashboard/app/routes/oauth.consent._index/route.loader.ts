import { redirect } from "react-router";
import { withSupabase } from "~/lib/.server/supabase";

export const loader = withSupabase(async ({ request, supabase }) => {
  const url = new URL(request.url);
  const authorizationId = url.searchParams.get("authorization_id");

  if (!authorizationId) {
    return {
      error: "Solicitação OAuth inválida: authorization_id ausente.",
      needsLogin: false,
      authorizationId: null,
      clientName: null,
      redirectUri: null,
      scopes: [] as string[],
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: null,
      needsLogin: true,
      authorizationId,
      clientName: null,
      redirectUri: null,
      scopes: [] as string[],
    };
  }

  const { data: details, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !details) {
    return {
      error: error?.message ?? "Não foi possível carregar a solicitação OAuth.",
      needsLogin: false,
      authorizationId,
      clientName: null,
      redirectUri: null,
      scopes: [] as string[],
    };
  }

  if (!("authorization_id" in details)) {
    return redirect(details.redirect_url);
  }

  return {
    error: null,
    needsLogin: false,
    authorizationId,
    clientName: details.client.name,
    redirectUri: details.redirect_uri,
    scopes: details.scope?.split(" ").filter(Boolean) ?? [],
  };
});
