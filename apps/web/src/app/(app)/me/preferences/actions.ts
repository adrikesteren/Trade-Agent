"use server";

import { createClient } from "@/lib/supabase/server";
import {
  USER_DATE_FORMAT_CHOICES,
  USER_DECIMAL_FORMAT_CHOICES,
  USER_TIME_FORMAT_CHOICES,
  USER_TIMEZONE_CHOICES,
} from "@/lib/locale/choices";
import type { UserDateFormat, UserDecimalFormat, UserTimeFormat, UserTimezone } from "@/lib/locale/types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const TZ_SET = new Set(USER_TIMEZONE_CHOICES.map((c) => c.value));
const DEC_SET = new Set(USER_DECIMAL_FORMAT_CHOICES.map((c) => c.value));
const DATE_SET = new Set(USER_DATE_FORMAT_CHOICES.map((c) => c.value));
const TIME_SET = new Set(USER_TIME_FORMAT_CHOICES.map((c) => c.value));

function parseTimezone(raw: unknown): UserTimezone {
  const v = String(raw ?? "").trim();
  return TZ_SET.has(v as UserTimezone) ? (v as UserTimezone) : "europe_amsterdam";
}

function parseDecimal(raw: unknown): UserDecimalFormat {
  const v = String(raw ?? "").trim();
  return DEC_SET.has(v as UserDecimalFormat) ? (v as UserDecimalFormat) : "comma_decimal";
}

function parseDateFmt(raw: unknown): UserDateFormat {
  const v = String(raw ?? "").trim();
  return DATE_SET.has(v as UserDateFormat) ? (v as UserDateFormat) : "dmy";
}

function parseTimeFmt(raw: unknown): UserTimeFormat {
  const v = String(raw ?? "").trim();
  return TIME_SET.has(v as UserTimeFormat) ? (v as UserTimeFormat) : "h24";
}

export async function updateUserLocalePreferences(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const timezone = parseTimezone(formData.get("timezone"));
  const decimal_format = parseDecimal(formData.get("decimal_format"));
  const date_format = parseDateFmt(formData.get("date_format"));
  const time_format = parseTimeFmt(formData.get("time_format"));

  const { error } = await supabase
    .from("user_preferences")
    .update({
      timezone,
      decimal_format,
      date_format,
      time_format,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/me/preferences");
  revalidatePath("/overview");
}
