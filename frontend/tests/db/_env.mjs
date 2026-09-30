// Shared helpers for HTTP (PostgREST) DB tests: local Supabase env resolution,
// an anon-key client, and a throwaway signed-up vendor fixture. Never reads or
// returns any key other than the API URL and the anon key.

import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

export function getLocalEnv() {
  if (process.env.SUPABASE_API_URL && process.env.SUPABASE_ANON_KEY) {
    return {
      apiUrl: process.env.SUPABASE_API_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
    };
  }

  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const status = JSON.parse(raw);

  if (!status.API_URL || !status.ANON_KEY) {
    throw new Error(
      "`supabase status -o json` did not report API_URL/ANON_KEY.",
    );
  }

  return { apiUrl: status.API_URL, anonKey: status.ANON_KEY };
}

export function anonClient() {
  const { apiUrl, anonKey } = getLocalEnv();
  return createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function randomDigits(n) {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

export async function signUpVendor() {
  const phone = "9" + randomDigits(9);
  const client = anonClient();

  const { data, error } = await client.auth.signUp({
    email: `${phone}@phone.local`,
    password: "123456",
  });

  if (error) throw error;
  if (!data.session || !data.user) {
    throw new Error("signUpVendor: no session returned after sign up.");
  }

  return { client, userId: data.user.id, phone };
}
