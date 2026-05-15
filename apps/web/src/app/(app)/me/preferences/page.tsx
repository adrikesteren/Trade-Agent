import {
  USER_DATE_FORMAT_CHOICES,
  USER_DECIMAL_FORMAT_CHOICES,
  USER_TIME_FORMAT_CHOICES,
  USER_TIMEZONE_CHOICES,
} from "@/lib/locale/choices";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { createClient } from "@/lib/supabase/server";
import { Button, Card, CardBody, Stack } from "@adrikesteren/adricore/blocks";
import { updateUserLocalePreferences } from "./actions";

export default async function MePreferencesPage() {
  const prefs = await getUserLocalePreferences();
  const supabase = await createClient();
  const { data: fiatRows } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("kind", "fiat")
    .order("code", { ascending: true })
    .limit(400);
  const fiatOptions = (fiatRows ?? []) as { id: string; code: string }[];

  return (
    <div className="bk-container bk-container_md bk-stack bk-stack_gap-md">
      <div>
        <h1 className="bk-page-header_title">My preferences</h1>
        <p className="bk-page-header_subtitle">How dates, times, numbers, and primary fiat appear in the app.</p>
      </div>

      <Card>
        <CardBody>
          <form className="bk-stack bk-stack_gap-md" action={updateUserLocalePreferences}>
            <Stack gap="md">
              <div>
                <label htmlFor="pref-timezone" className="bk-form-label">
                  Timezone
                </label>
                <select
                  id="pref-timezone"
                  name="timezone"
                  className="bk-input mt-1 w-full max-w-md text-sm"
                  defaultValue={prefs.timezone}
                >
                  {USER_TIMEZONE_CHOICES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pref-decimal" className="bk-form-label">
                  Decimal format
                </label>
                <select
                  id="pref-decimal"
                  name="decimal_format"
                  className="bk-input mt-1 w-full max-w-md text-sm"
                  defaultValue={prefs.decimal_format}
                >
                  {USER_DECIMAL_FORMAT_CHOICES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pref-date" className="bk-form-label">
                  Date format
                </label>
                <select
                  id="pref-date"
                  name="date_format"
                  className="bk-input mt-1 w-full max-w-md text-sm"
                  defaultValue={prefs.date_format}
                >
                  {USER_DATE_FORMAT_CHOICES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pref-time" className="bk-form-label">
                  Time format
                </label>
                <select
                  id="pref-time"
                  name="time_format"
                  className="bk-input mt-1 w-full max-w-md text-sm"
                  defaultValue={prefs.time_format}
                >
                  {USER_TIME_FORMAT_CHOICES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pref-primary-asset" className="bk-form-label">
                  Primary currency (fiat)
                </label>
                <select
                  id="pref-primary-asset"
                  name="primary_asset_id"
                  className="bk-input mt-1 w-full max-w-md text-sm"
                  required
                  defaultValue={prefs.primary_asset?.id ?? ""}
                >
                  {fiatOptions.length === 0 ? (
                    <option value="" disabled>
                      No fiat assets in catalog
                    </option>
                  ) : (
                    fiatOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.code}
                      </option>
                    ))
                  )}
                </select>
                <p className="bk-text-muted mt-1 text-xs">
                  Wallet balances use catalog <span className="font-mono">dollar_value</span> (USD per unit) to show an approximation in this currency when rates exist.
                </p>
              </div>

              <div>
                <Button type="submit" variant="brand" disabled={fiatOptions.length === 0}>
                  Save
                </Button>
              </div>
            </Stack>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
