import {
  USER_DATE_FORMAT_CHOICES,
  USER_DECIMAL_FORMAT_CHOICES,
  USER_TIME_FORMAT_CHOICES,
  USER_TIMEZONE_CHOICES,
} from "@/lib/locale/choices";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { Button, Card, CardBody, PageHeader, Stack } from "@repo/blocks";
import { updateUserLocalePreferences } from "./actions";

export default async function MePreferencesPage() {
  const prefs = await getUserLocalePreferences();

  return (
    <div className="bk-container bk-container_md bk-stack bk-stack_gap-md">
      <PageHeader
        eyebrow="Account"
        title="My preferences"
        subtitle="How dates, times, and numbers appear in the dashboard."
      />

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
                <Button type="submit" variant="brand">
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
