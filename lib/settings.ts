import "server-only";
import { db } from "./supabase";
import { DEFAULT_CONFIG, sanitizeConfig, type RuleConfig } from "./config";

const KEY = "rules";

/** Current rule config. Falls back to defaults if the settings table hasn't been created yet. */
export async function loadConfig(): Promise<{ config: RuleConfig; persisted: boolean; updated_at: string | null; error?: string }> {
  const { data, error } = await db().from("settings").select("value, updated_at").eq("id", KEY).maybeSingle();
  if (error) return { config: DEFAULT_CONFIG, persisted: false, updated_at: null, error: error.message };
  if (!data) return { config: DEFAULT_CONFIG, persisted: true, updated_at: null };
  return { config: sanitizeConfig(data.value), persisted: true, updated_at: data.updated_at };
}

export async function saveConfig(input: unknown): Promise<RuleConfig> {
  const config = sanitizeConfig(input);
  const { error } = await db().from("settings").upsert({ id: KEY, value: config, updated_at: new Date().toISOString() });
  if (error) {
    const missing = /settings/.test(error.message) && /(does not exist|schema cache|not find)/i.test(error.message);
    throw new Error(missing ? "The settings table doesn't exist yet — run supabase/migrations/002_settings.sql in the Supabase SQL editor." : error.message);
  }
  return config;
}
