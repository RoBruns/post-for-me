import type { RatelimitRequest } from "@unkey/api/models/components";

const SELF_HOSTED = process.env.SELF_HOSTED === "true";

export const UNKEY_ROOT_KEY = process.env?.UNKEY_ROOT_KEY || "";
export const UNKEY_API_ID = process.env?.UNKEY_API_ID || "";

if (!SELF_HOSTED && (!UNKEY_ROOT_KEY || UNKEY_ROOT_KEY.trim() === "")) {
  throw new Error("UNKEY_ROOT_KEY is not defined");
}

if (!SELF_HOSTED && (!UNKEY_API_ID || UNKEY_API_ID.trim() === "")) {
  throw new Error("UNKEY_API_ID is not defined");
}

export const RATE_LIMITS: RatelimitRequest[] = [
  {
    name: "per_minute_use",
    limit: 40,
    duration: 60000,
    autoApply: true,
  },
  {
    name: "per_second_use",
    limit: 5,
    duration: 1000,
    autoApply: true,
  },
];
