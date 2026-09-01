import { createClient } from "@supabase/supabase-js";
import { logger, task } from "@trigger.dev/sdk";
import Stripe from "stripe";
import { Database } from "./supabase.types";

const SELF_HOSTED = process.env.SELF_HOSTED === "true";
const stripe =
  !SELF_HOSTED && process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

const supabaseClient = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type IncrementTeamUsagePayload = {
  team_id: string;
  stripe_customer_id: string;
};

const getSubscriptionItemProduct = async (
  stripeClient: Stripe,
  item: Stripe.SubscriptionItem,
): Promise<Stripe.Product> => {
  const product = item.price.product;
  const productId = typeof product === "string" ? product : product.id;
  const retrievedProduct = await stripeClient.products.retrieve(productId);

  if ("deleted" in retrievedProduct && retrievedProduct.deleted) {
    throw new Error("Subscription product is deleted");
  }

  return retrievedProduct;
};

const getSocialPostLimit = async (
  stripeClient: Stripe,
  item: Stripe.SubscriptionItem,
): Promise<number> => {
  const product = await getSubscriptionItemProduct(stripeClient, item);
  const limitValue = product.metadata.social_post_limit;
  const limit = Number(limitValue);

  if (!limitValue || !Number.isFinite(limit) || limit <= 0) {
    throw new Error("Missing or invalid social_post_limit product metadata");
  }

  return limit;
};

export const incrementTeamUsage = task({
  id: "increment-team-usage",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async (payload: IncrementTeamUsagePayload) => {
    if (SELF_HOSTED) {
      logger.info("Skipping hosted usage accounting in self-hosted mode");
      return { skipped: true };
    }

    if (!stripe) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }

    const { team_id, stripe_customer_id } = payload;
    const subscriptions = await stripe.subscriptions.list({
      customer: stripe_customer_id,
      status: "active",
      limit: 1,
    });

    const subscription = subscriptions.data[0];
    if (!subscription) throw new Error("No active subscription found");

    const subscriptionItem = subscription.items.data[0];
    if (!subscriptionItem) throw new Error("No subscription items found");

    const limit = await getSocialPostLimit(stripe, subscriptionItem);
    const startAt = new Date(
      subscriptionItem.current_period_start * 1000,
    ).toISOString();
    const endAt = new Date(
      subscriptionItem.current_period_end * 1000,
    ).toISOString();

    const { data: count, error } = await supabaseClient.rpc(
      "increment_team_usage",
      {
        p_team_id: team_id,
        p_limit: limit,
        p_start_at: startAt,
        p_end_at: endAt,
      },
    );

    if (error) throw error;

    return {
      count,
      limit,
      start_at: startAt,
      end_at: endAt,
      subscription_id: subscription.id,
    };
  },
});
