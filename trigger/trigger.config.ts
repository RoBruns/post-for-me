import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg, syncEnvVars } from "@trigger.dev/build/extensions/core";
import * as dotenv from "dotenv";

dotenv.config();

const runtimeEnvNames = [
  "SELF_HOSTED",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "POST_HOG_API_KEY",
  "POST_HOG_API_HOST",
  "LOOPS_API_KEY",
] as const;

export default defineConfig({
  project: "proj_shhvvnfshigtpypjhnii",
  build: {
    extensions: [
      ffmpeg(),
      syncEnvVars(async () => {
        return Object.fromEntries(
          runtimeEnvNames
            .map((name) => [name, process.env[name]])
            .filter((entry): entry is [string, string] => Boolean(entry[1])),
        );
      }),
    ],
    external: ["fluent-ffmpeg", "jsdom", "sharp", "tus-js-client"],
  },
  runtime: "node-22",
  logLevel: "log",
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["."],
});
