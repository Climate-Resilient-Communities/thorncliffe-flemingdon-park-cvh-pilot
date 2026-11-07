// "From residents, to add or apply" as it is drawn on the Providers page (PRD §6.3): each accepted suggestion with what it is, where, a link to
// its review page for every answer, and "Mark as done". `apply` is the button for one item (the page gives ApplyForm); the tests give none.
import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import type { FromResidentView } from "./residents";

const t = (key: string) => englishText(`staff.moderation.toApply.${key}`);

export function FromResidents({ items, apply }: { items: readonly FromResidentView[]; apply?: (item: FromResidentView) => ReactNode }) {
  return (
    <section aria-labelledby="from-residents-title" data-testid="from-residents">
      <Stack gap="related">
        <h2 id="from-residents-title" className="hub-wrap">
          {t("title")}
        </h2>
        <p>{t("lead")}</p>
        {items.length === 0 ? (
          <p data-testid="from-residents-none">{t("none")}</p>
        ) : (
          <Stack as="ul" gap="related">
            {items.map((item) => (
              <li key={item.id} className="hub-esc" data-testid="from-residents-item">
                <Stack gap="subline">
                  <div className="hub-esc__head">
                    <span className="hub-pill">{item.kind}</span>
                    <span className="hub-esc__time hub-wrap">{item.accepted}</span>
                  </div>
                  <p className="hub-esc__where hub-wrap">{item.name}</p>
                  {item.gloss && <p className="hub-wrap">{item.gloss}</p>}
                  {item.rows.map((row) => (
                    <p key={row.label} className="hub-wrap">
                      <strong>{row.label}:</strong> {row.value}
                    </p>
                  ))}
                  <a className="tap hub-link" href={item.reviewHref}>
                    {englishText("O08.open")}
                  </a>
                  {apply?.(item)}
                </Stack>
              </li>
            ))}
          </Stack>
        )}
      </Stack>
    </section>
  );
}
