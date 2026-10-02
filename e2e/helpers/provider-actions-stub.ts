// Stands in for src/app/staff/providers/actions.ts in the screenshot harness (e2e/helpers/layout-fixture.ts), which
// renders ProviderList without a server. The real actions are "use server" modules that reach the database; these
// answer in the shapes the real ones do, so the screenshots can show a refusal and a done message. Only the harness
// uses this file.
import type { ProviderActionState } from "../../src/app/staff/providers/changeProvider";

const providerId = (form: FormData) => String(form.get("providerId") ?? "");

/** "Save date": always refused, as a date later than today would be. */
export async function confirmProviderAction(_previous: ProviderActionState, form: FormData): Promise<ProviderActionState> {
  return { status: "refused", providerId: providerId(form), message: "The date cannot be later than today." };
}

/** "Publish": refused, as a provider with no date would be. */
export async function publishProviderAction(_previous: ProviderActionState, form: FormData): Promise<ProviderActionState> {
  return { status: "refused", providerId: providerId(form), message: "Confirm this provider first" };
}

/** "Unpublish": done. */
export async function unpublishProviderAction(_previous: ProviderActionState, form: FormData): Promise<ProviderActionState> {
  return { status: "done", providerId: providerId(form), message: "East York Food Bank is no longer published." };
}
