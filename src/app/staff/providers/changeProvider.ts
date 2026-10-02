import { englishText } from "@/i18n/text";
import { confirmProvider, publishProvider, unpublishProvider, type ProviderError, type ProviderOptions, type ProviderResult } from "@/modules/directory";
import type { Db } from "@/platform/db";
import type { StaffSession } from "../session";

/** What a provider row shows after one of its buttons was pressed. Every text is already resolved from the catalog. */
export type ProviderActionState =
  | { status: "idle" }
  | { status: "done"; providerId: string; message: string }
  | { status: "refused"; providerId: string; message: string };

export interface ProviderActionDeps {
  db: () => Db;
  /** Test seam: the clock the date check and the publish time use. */
  options?: ProviderOptions;
}

const ERROR_KEYS: Record<ProviderError, string> = {
  not_found: "staff.providers.errors.notFound",
  confirm_first: "staff.providers.errors.confirmFirst",
  not_in_catalogue: "staff.providers.errors.notInCatalogue",
  already_published: "staff.providers.errors.alreadyPublished",
  not_published: "staff.providers.errors.notPublished",
  date_invalid: "staff.providers.errors.dateInvalid",
  date_in_future: "staff.providers.errors.dateInFuture",
};

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

export const providerIdOf = (form: FormData) => field(form, "providerId");

function answer(providerId: string, result: ProviderResult, doneKey: string, values: (name: string) => Record<string, string>): ProviderActionState {
  if (!result.ok) return { status: "refused", providerId, message: englishText(ERROR_KEYS[result.error]) };
  return { status: "done", providerId, message: englishText(doneKey, values(result.name)) };
}

/** "Publish" on a provider row. The use case decides and audits; "Confirm this provider first" when it has no date. */
export async function publishFromForm(deps: ProviderActionDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<ProviderActionState> {
  const providerId = providerIdOf(form);
  const result = await publishProvider(deps.db(), session.staffId, providerId, deps.options);
  return answer(providerId, result, "staff.providers.done.published", (name) => ({ name }));
}

/** "Unpublish" on a provider row. */
export async function unpublishFromForm(deps: ProviderActionDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<ProviderActionState> {
  const providerId = providerIdOf(form);
  const result = await unpublishProvider(deps.db(), session.staffId, providerId, deps.options);
  return answer(providerId, result, "staff.providers.done.unpublished", (name) => ({ name }));
}

/** "Save date" on a provider row: the last-confirmed date, today or earlier. */
export async function confirmFromForm(deps: ProviderActionDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<ProviderActionState> {
  const providerId = providerIdOf(form);
  const date = field(form, "date");
  const result = await confirmProvider(deps.db(), session.staffId, providerId, date, deps.options);
  return answer(providerId, result, "staff.providers.done.confirmed", (name) => ({ name, date }));
}
