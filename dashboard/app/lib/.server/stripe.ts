import Stripe from "stripe";

import { STRIPE_SECRET_KEY } from "./stripe.constants";

export const stripe = new Stripe(
  STRIPE_SECRET_KEY || "sk_self_hosted_disabled",
  { typescript: true },
);
