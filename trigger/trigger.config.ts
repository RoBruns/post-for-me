import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg } from "@trigger.dev/build/extensions/core";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  project: "proj_shhvvnfshigtpypjhnii",
  build: {
    extensions: [ffmpeg()],
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
