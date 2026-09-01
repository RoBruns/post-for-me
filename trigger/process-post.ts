import { logger, task, tasks, tags } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import type {
  IndividualPostData,
  PlatformAppCredentials,
  PlatformConfiguration,
  Post,
  PostResult,
  UserTag,
} from "./posting/post.types";
import { Database } from "./supabase.types";

const supabaseClient = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SELF_HOSTED = process.env.SELF_HOSTED === "true";

export const processPost = task({
  id: "process-post",
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload: { index: number; post: Post }) => {
    const { post } = payload;
    logger.info("Starting post processing", {
      post_id: post.id,
      project_id: post.project_id,
      self_hosted: SELF_HOSTED,
    });

    await tags.add([`${post.id}`, `${post.project_id}`]);

    const accounts = post.social_post_provider_connections?.map(
      ({ social_provider_connections: connection }) => ({ ...connection }),
    );

    const errorResults: PostResult[] = [];

    try {
      if (!accounts || accounts.length === 0) {
        logger.error("No accounts found for post", { post_id: post.id });
        return [];
      }

      // Authentication already happened at the API boundary. In self-hosted mode
      // the API key is stored/verified in Supabase, so the worker must not call
      // the hosted Unkey service again.
      if (SELF_HOSTED) {
        logger.info("Skipping hosted API-key revalidation in self-hosted mode");
      }

      const { data: project, error: projectError } = await supabaseClient
        .from("projects")
        .select(
          `
          *,
          teams(
            stripe_customer_id
          ),
          social_provider_app_credentials(
            provider,
            app_id,
            app_secret
          )
          `,
        )
        .eq("id", post.project_id)
        .single();

      if (projectError || !project) {
        logger.error("Project not found", { projectError, project });
        errorResults.push(
          ...accounts.map((connection) => ({
            success: false,
            provider_connection_id: connection.id,
            post_id: post.id,
            error_message: "No project found",
          })),
        );
        throw new Error("No project found");
      }

      await tags.add(`${project.team_id}`);

      const postMedia: {
        id: string;
        provider?: string | null;
        provider_connection_id?: string | null;
        url: string;
        thumbnail_url: string;
        thumbnail_timestamp_ms?: number | null;
        type: string;
        tags?: UserTag[] | null;
        skip_processing?: boolean | null;
      }[] = [];

      if (post.social_post_media && post.social_post_media.length > 0) {
        logger.info("Localizing media", { media_count: post.social_post_media.length });

        const localizedMedia = await tasks.batchTriggerAndWait(
          "process-post-medium",
          post.social_post_media.map((medium) => ({
            payload: {
              medium: {
                id: medium.id,
                provider: medium.provider,
                provider_connection_id: medium.provider_connection_id,
                url: medium.url,
                thumbnail_url: medium.thumbnail_url,
                thumbnail_timestamp_ms: medium.thumbnail_timestamp_ms,
                tags: medium.tags,
                skip_processing: medium.skip_processing,
              },
            },
          })),
        );

        const successfulMedia = localizedMedia.runs
          .filter((run) => run.ok)
          .map((run) => run.output);

        const postImages = successfulMedia.filter(
          (medium) => medium.type !== "video",
        );
        const postVideos = successfulMedia.filter(
          (medium) => medium.type === "video",
        );

        postMedia.push(...postImages);
        postMedia.push(...postVideos.filter((medium) => medium.skip_processing));

        const videosToProcess = postVideos.filter(
          (medium) => !medium.skip_processing,
        );

        if (videosToProcess.length > 0) {
          const processVideosResult = await tasks.batchTriggerAndWait(
            "ffmpeg-process-video",
            videosToProcess.map((video) => ({ payload: { medium: video } })),
          );

          postMedia.push(
            ...processVideosResult.runs
              .filter((run) => run.ok)
              .map((run) => run.output),
          );
        }

        if (postMedia.length === 0) {
          errorResults.push(
            ...accounts.map((connection) => ({
              success: false,
              provider_connection_id: connection.id,
              post_id: post.id,
              error_message:
                "All media failed to process, please check media URLs",
            })),
          );
          throw new Error("All media failed to process");
        }
      }

      const teams = project.teams as unknown as
        | { stripe_customer_id?: string | null }
        | null;
      const billingCustomerId = teams?.stripe_customer_id || project.team_id;

      const postData = {
        id: post.id,
        billing_customer_id: billingCustomerId,
        caption: post.caption,
        configurations: post.social_post_configurations,
        media: postMedia,
        accounts,
      };

      const bulkPostData: IndividualPostData[] = [];
      const storyBulkPostData: IndividualPostData[] = [];

      for (const account of postData.accounts) {
        try {
          let appCredentials: PlatformAppCredentials | null = null;

          switch (account.provider) {
            case "bluesky":
              appCredentials = {
                app_id: "blue_sky_app_id",
                app_secret: "blue_sky_app_secret",
              };
              break;
            case "instagram":
              switch (account.social_provider_metadata?.connection_type) {
                case "instagram":
                  appCredentials = project.social_provider_app_credentials.find(
                    (credential) => credential.provider === "instagram",
                  ) as PlatformAppCredentials | undefined || null;
                  break;
                case "facebook":
                  appCredentials = project.social_provider_app_credentials.find(
                    (credential) =>
                      credential.provider === "instagram_w_facebook",
                  ) as PlatformAppCredentials | undefined || null;
                  break;
                default:
                  appCredentials = project.social_provider_app_credentials.find(
                    (credential) =>
                      credential.provider === account.provider ||
                      credential.provider === "instagram_w_facebook",
                  ) as PlatformAppCredentials | undefined || null;
                  break;
              }
              break;
            case "x":
              appCredentials = project.social_provider_app_credentials.find(
                (credential) =>
                  credential.provider ===
                  (account.social_provider_metadata?.connection_type === "oauth2"
                    ? "x_oauth2"
                    : "x"),
              ) as PlatformAppCredentials | undefined || null;
              break;
            default:
              appCredentials = project.social_provider_app_credentials.find(
                (credential) => credential.provider === account.provider,
              ) as PlatformAppCredentials | undefined || null;
              break;
          }

          if (!appCredentials) {
            errorResults.push({
              success: false,
              provider_connection_id: account.id,
              post_id: post.id,
              error_message: `No app credentials found for provider ${account.provider}`,
            });
            continue;
          }

          const platformConfig = postData.configurations.filter(
            (config) => config.provider === account.provider,
          )?.[0];
          const accountConfig = postData.configurations.filter(
            (config) => config.provider_connection_id === account.id,
          )?.[0];
          const platformMedia = postData.media.filter(
            (medium) => medium.provider === account.provider,
          );
          const accountMedia = postData.media.filter(
            (medium) => medium.provider_connection_id === account.id,
          );
          const defaultMedia = postData.media.filter(
            (medium) => !medium.provider && !medium.provider_connection_id,
          );

          const caption =
            accountConfig?.caption || platformConfig?.caption || postData.caption;
          const media =
            accountMedia.length > 0
              ? accountMedia
              : platformMedia.length > 0
                ? platformMedia
                : defaultMedia;

          const platformData = {
            ...platformConfig?.provider_data,
            ...accountConfig?.provider_data,
          } as PlatformConfiguration;

          const individualPostData: IndividualPostData = {
            stripeCustomerId: postData.billing_customer_id,
            teamId: project.team_id,
            platform: account.provider,
            postId: postData.id,
            account,
            media,
            caption,
            platformConfig: platformData,
            appCredentials,
            projectId: post.project_id,
          };

          if (
            (platformData as { placement?: string }).placement === "stories"
          ) {
            for (const medium of media) {
              storyBulkPostData.push({ ...individualPostData, media: [medium] });
            }
          } else {
            bulkPostData.push(individualPostData);
          }
        } catch (error: any) {
          logger.error("Failed constructing platform post", { error });
          errorResults.push({
            success: false,
            error_message: error?.message || "Unknown error",
            provider_connection_id: account.id,
            post_id: postData.id,
            details: { error },
          });
        }
      }

      if (bulkPostData.length > 0) {
        await tasks.batchTriggerAndWait(
          "post-to-platform",
          bulkPostData.map((data) => ({ payload: data })),
        );
      }

      for (const storyPostData of storyBulkPostData) {
        await tasks.triggerAndWait("post-to-platform", storyPostData);
      }
    } catch (error) {
      logger.error("Unexpected error while processing post", { error });
    } finally {
      if (errorResults.length > 0) {
        const { data: insertedPostResults, error: insertResultsError } =
          await supabaseClient
            .from("social_post_results")
            .insert(errorResults)
            .select();

        if (insertResultsError) {
          logger.error("Failed to insert post results", { insertResultsError });
        } else if (insertedPostResults) {
          await tasks.batchTrigger(
            "process-webhooks",
            insertedPostResults.map((result) => ({
              payload: {
                projectId: post.project_id,
                eventType: "social.post.result.created",
                eventData: {
                  details: result.details,
                  id: result.id,
                  error: result.error_message,
                  platform_data: {
                    id: result.provider_post_id,
                    url: result.provider_post_url,
                  },
                  post_id: result.post_id,
                  social_account_id: result.provider_connection_id,
                  success: result.success,
                },
              },
            })),
          );
        }
      }

      const { data: updatedPost, error: updatePostError } = await supabaseClient
        .from("social_posts")
        .update({ status: "processed" })
        .eq("id", post.id)
        .select("*")
        .single();

      if (updatePostError) {
        logger.error("Failed to update post status", { updatePostError });
      } else if (updatedPost) {
        await tasks.trigger("process-webhooks", {
          projectId: post.project_id,
          eventType: "social.post.updated",
          eventData: updatedPost,
        });
      }
    }
  },
});
