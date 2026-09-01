import { logger, schedules } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const unkeyTmpKeyCleanup = schedules.task({
  cron: { pattern: "0 */1 * * *", environments: ["PRODUCTION"] },
  id: "self-hosted-tmp-key-cleanup",
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  machine: "small-1x",
  run: async () => {
    if (process.env.SELF_HOSTED !== "true") {
      logger.info("Skipping self-hosted temporary key cleanup");
      return;
    }

    const { data, error } = await supabase
      .from("self_hosted_api_keys")
      .delete()
      .like("key_prefix", "pfm_tmp%")
      .not("expires_at", "is", null)
      .lt("expires_at", new Date().toISOString())
      .select("id");

    if (error) {
      logger.error("Failed to clean up expired temporary API keys", { error });
      throw new Error(error.message);
    }

    logger.info("Expired temporary API keys cleaned up", {
      deleted: data?.length || 0,
    });
  },
});
