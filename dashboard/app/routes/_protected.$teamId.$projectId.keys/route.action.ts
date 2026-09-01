import { data } from "react-router";
import { customerHasActiveSubscriptions } from "~/lib/.server/customer-has-active-subscriptions.request";
import { customerHasSubscriptionSystemCredsAddon } from "~/lib/.server/customer-has-subscription-system-creds-addon.request";

import { withSupabase } from "~/lib/.server/supabase";
import { unkey } from "~/lib/.server/unkey";
import { RATE_LIMITS, UNKEY_API_ID } from "~/lib/.server/unkey.constants";
import { stripe } from "~/lib/.server/stripe";
import { getSubscriptionPlanInfo } from "~/lib/.server/get-subscription-plan-info";
import {
  SELF_HOSTED,
  createSelfHostedApiKey,
} from "~/lib/.server/self-hosted-api-keys";

export const action = withSupabase(
  async ({ supabase, supabaseServiceRole, params }) => {
    const { teamId, projectId } = params;

    if (!teamId) throw new Error("Team code is required");
    if (!projectId) throw new Error("Project ID is required");

    const currentUser = await supabase.auth.getUser();
    if (!currentUser.data?.user) throw new Error("User not found");

    const project = await supabaseServiceRole
      .from("projects")
      .select("id, team_id, is_system")
      .eq("id", projectId)
      .eq("team_id", teamId)
      .maybeSingle();

    if (project.error || !project.data) {
      return data({ success: false, error: "Not found", result: null });
    }

    if (SELF_HOSTED) {
      try {
        const apiKey = await createSelfHostedApiKey({
          supabaseServiceRole,
          projectId,
          teamId,
          createdBy: currentUser.data.user.id,
        });

        return data({
          success: true,
          error: null,
          result: { key: apiKey.key },
        });
      } catch (error) {
        return data({
          success: false,
          error: (error as { message?: string }).message,
          result: null,
        });
      }
    }

    const team = await supabase
      .from("teams")
      .select("stripe_customer_id")
      .eq("id", teamId)
      .single();

    if (!team.data) {
      return data({ success: false, error: "Not found", result: null });
    }

    const hasActiveSubscription = project.data.is_system
      ? await customerHasSubscriptionSystemCredsAddon(
          team.data.stripe_customer_id,
        )
      : await customerHasActiveSubscriptions(team.data.stripe_customer_id);

    if (!hasActiveSubscription) {
      return data({
        success: false,
        toast_msg: "You must have an active subscription to create an API key",
        result: null,
      });
    }

    const planMetadata: Record<string, string> = {};
    if (team.data.stripe_customer_id) {
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: team.data.stripe_customer_id,
          status: "active",
          limit: 1,
        });

        if (subscriptions.data.length > 0) {
          const planInfo = getSubscriptionPlanInfo(subscriptions.data[0]);
          if (planInfo.productId) planMetadata.plan_product_id = planInfo.productId;
          if (planInfo.planName) planMetadata.plan_name = planInfo.planName;
          if (planInfo.postLimit) {
            planMetadata.plan_post_limit = planInfo.postLimit.toString();
          }
          planMetadata.plan_type = planInfo.isNewPricing
            ? "new_pricing"
            : planInfo.isLegacy
              ? "legacy"
              : "unknown";
        }
      } catch (error) {
        console.error("Error fetching plan info for API key metadata:", error);
      }
    }

    try {
      const apiKey = await unkey.keys.createKey({
        apiId: UNKEY_API_ID,
        prefix: "pfm_live",
        name: "API Key",
        externalId: projectId,
        meta: {
          project_id: projectId,
          team_id: teamId,
          created_by: currentUser.data.user.id,
          ...planMetadata,
        },
        enabled: true,
        recoverable: false,
        ratelimits: RATE_LIMITS,
      });

      return data({
        success: true,
        error: null,
        result: { key: apiKey.data.key },
      });
    } catch (error) {
      return data({
        success: false,
        error: (error as { message?: string }).message,
        result: null,
      });
    }
  },
);
