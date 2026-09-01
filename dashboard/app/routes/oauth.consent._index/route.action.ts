import { redirect } from "react-router";
import { withSupabase } from "~/lib/.server/supabase";

export const action = withSupabase(async ({ request, supabase }) => {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/sign-in");
  }

  const formData = await request.formData();
  const authorizationId = String(formData.get("authorization_id") || "");
  const decision = String(formData.get("decision") || "");

  if (!authorizationId) {
    return new Response("authorization_id ausente", { status: 400 });
  }

  if (decision !== "approve" && decision !== "deny") {
    return new Response("Decisão OAuth inválida", { status: 400 });
  }

  const result =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);

  if (result.error || !result.data) {
    return new Response(
      result.error?.message ?? "Não foi possível processar a autorização.",
      { status: 400 },
    );
  }

  return redirect(result.data.redirect_url);
});
