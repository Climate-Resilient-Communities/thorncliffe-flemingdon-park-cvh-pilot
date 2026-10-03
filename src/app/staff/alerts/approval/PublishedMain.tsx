// The main column of the published confirmation (O-06, S04.10): what an approved entry did and where it went. Pure; ApprovalBody draws it for an entry that is
// approved, beside the aside that holds every language's web text and text message.
import { Stack } from "@/ui";
import type { ApprovalScreen, PublishedLanguageView, PublishedRowView } from "./view";

function Languages({ label, items, id }: { label: string; items: PublishedLanguageView[]; id: string }) {
  return (
    <p className="hub-wrap" aria-label={label} data-testid={id}>
      {items.map((language, index) => (
        <span key={language.lang}>
          {index > 0 && " · "}
          <span lang={language.bcp47} dir={language.dir} data-testid={`${id}-${language.lang}`}>
            {language.native}
          </span>
        </span>
      ))}
    </p>
  );
}

function Row({ row }: { row: PublishedRowView }) {
  return (
    <li className="hub-list-item" data-testid={`where-${row.id}`}>
      <Stack gap="subline">
        <p className="hub-wrap">
          <strong>{row.label}</strong>
        </p>
        <p className="hub-wrap">{row.value}</p>
        {row.languages && <Languages label={row.languages.label} items={row.languages.items} id={`where-${row.id}-languages`} />}
      </Stack>
    </li>
  );
}

export function PublishedMain({ screen }: { screen: ApprovalScreen & { published: NonNullable<ApprovalScreen["published"]> } }) {
  const { published } = screen;
  return (
    <Stack gap="section-hub-review">
      <Stack gap="related">
        <h1 className="hub-wrap" data-testid="published-title">{published.title}</h1>
        <p data-testid="entry-header">
          <strong>{screen.header.types}</strong>
          {screen.header.submitted ? ` · ${screen.header.submitted}` : ""}
        </p>
        {screen.header.drill && (
          <p role="note" className="hub-flag" data-testid="drill-note">
            {screen.header.drill}
          </p>
        )}
        {published.drill && (
          <p role="note" className="hub-flag hub-wrap" data-testid="published-drill">
            {published.drill}
          </p>
        )}
        {screen.locked && (
          <p role="note" className="hub-flag" data-testid="locked-note">
            {screen.locked.message}
          </p>
        )}
        {/* While texts are paused (S06.06): the confirmation of an approval says so. It only informs. */}
        {screen.pauseNotice && (
          <p role="note" className="hub-flag" data-testid="pause-notice">
            {screen.pauseNotice}
          </p>
        )}
      </Stack>
      <section aria-labelledby="where-title" data-testid="where">
        <Stack gap="related">
          <h2 id="where-title" className="hub-wrap">{published.whereTitle}</h2>
          <Stack as="ul" gap="related">
            {published.rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </Stack>
        </Stack>
      </section>
      <section aria-labelledby="english-title" data-testid="english-text">
        <Stack gap="related">
          <h2 id="english-title" className="hub-wrap">{screen.english.title}</h2>
          <p className="hub-wrap hub-prewrap" lang="en" data-testid="english-body">
            {screen.english.body}
          </p>
        </Stack>
      </section>
      <section aria-labelledby="next-title" data-testid="next">
        <Stack gap="related">
          <h2 id="next-title" className="hub-wrap">{published.next.title}</h2>
          {published.next.lines.map((line) => (
            <p key={line} className="hub-wrap">
              {line}
            </p>
          ))}
          <Stack as="ul" gap="subline">
            {published.next.links.map((link) => (
              <li key={link.id}>
                <a className="tap hub-link hub-wrap" href={link.href} data-testid={`next-${link.id}`}>
                  {link.label}
                </a>
              </li>
            ))}
          </Stack>
        </Stack>
      </section>
    </Stack>
  );
}
