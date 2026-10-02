import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isolatedInString } from "../text/isolated";
import { ChoiceOption, ToldRow } from "./parts";

const noop = () => undefined;

describe("ChoiceOption", () => {
  const option = (extra: Partial<Parameters<typeof ChoiceOption>[0]>) =>
    renderToStaticMarkup(<ChoiceOption kind="checkbox" name="b" value="1" checked={false} onChange={noop} label="85 Thorncliffe Park Dr" line="Thorncliffe Park" {...extra} />);

  it("with isolate, shows the address and the neighbourhood as isolated left-to-right English runs", () => {
    const html = option({ isolate: true });

    expect(html).toContain('<span class="choice-option__label"><bdi lang="en" dir="ltr">85 Thorncliffe Park Dr</bdi></span>');
    expect(html).toContain('<span class="choice-option__line"><bdi lang="en" dir="ltr">Thorncliffe Park</bdi></span>');
  });

  it("without isolate, shows the words as they are", () => {
    const html = option({ label: "Seniors", line: undefined });

    expect(html).not.toContain("<bdi");
    expect(html).toContain(">Seniors<");
  });

  it("shows a label that is already an element as it is, even with isolate", () => {
    const html = option({ label: <b>Floor 2</b>, line: undefined, isolate: true });

    expect(html).toContain("<b>Floor 2</b>");
    expect(html).not.toContain("<bdi");
  });
});

describe("ToldRow", () => {
  const row = (extra: Partial<Parameters<typeof ToldRow>[0]>) =>
    renderToStaticMarkup(<ToldRow label="85 Thorncliffe Park Dr" caption="Thorncliffe Park" remove={noop} removeText="Remove" removeLabel="Remove" testId="row" {...extra} />);

  it("with isolate, shows the address and the neighbourhood as isolated left-to-right English runs", () => {
    const html = row({ isolate: true });

    expect(html).toContain('<p class="choice-told__value"><bdi lang="en" dir="ltr">85 Thorncliffe Park Dr</bdi></p>');
    expect(html).toContain('<p class="choice-hint"><bdi lang="en" dir="ltr">Thorncliffe Park</bdi></p>');
  });

  it("without isolate, the words are the whole content of their paragraph, and a fallback marks the paragraph itself", () => {
    expect(row({ label: "Seniors", caption: undefined })).toContain('<p class="choice-told__value">Seniors</p>');
    const fallback = row({ label: "[EN] Seniors", caption: "[EN] Older adults" });
    expect(fallback).toContain('<p class="choice-told__value" lang="en" dir="ltr">[EN] Seniors</p>');
    expect(fallback).toContain('<p class="choice-hint" lang="en" dir="ltr">[EN] Older adults</p>');
    expect(fallback).not.toContain("<bdi");
  });

  it("puts the button's aria-label on the button", () => {
    const label = `Remove: ${isolatedInString("85 Thorncliffe Park Dr")}`;

    expect(row({ removeLabel: label })).toContain(`aria-label="${label}"`);
    expect(label).toBe("Remove: ⁨85 Thorncliffe Park Dr⁩");
  });
});
