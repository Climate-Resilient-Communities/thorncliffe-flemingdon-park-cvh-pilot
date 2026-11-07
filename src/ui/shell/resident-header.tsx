import { ChoicesTool } from "./choices-tool";
import { DisplaySettings, type DisplaySettingsLabels } from "./display-settings";
import Image from "next/image";
import { Inline } from "../layout/inline";
import { LanguageControl, type LanguageControlProps } from "./language-control";
import { ResidentNav, type ResidentNavProps } from "./resident-nav";

export type ResidentHeaderProps = LanguageControlProps & {
  logoAlt: string;
  display?: DisplaySettingsLabels;
  /** The words of the "My choices" tool (shell.choicesShort); without them the header draws no such tool. */
  choicesLabel?: string;
};

// The hub logo, scaled to 4x the height it is drawn at (public/brand/hub-logo.png, from the prototype's assets).
const LOGO = { src: "/brand/hub-logo.png", width: 423, height: 136 } as const;

/**
 * C_ResidentHeader: the Hub logo, "My choices" (R-34), the language button and the compact Aa button that opens the
 * display settings. The logo and the tools swap ends in right-to-left because this is an Inline that justifies between,
 * not because of a [dir] rule.
 * From the desktop breakpoint the four destinations sit in this row too, between the logo and the tools (`nav`, drawn
 * only there: on a phone the shell's bottom bar is the navigation).
 */
export function ResidentHeader({ logoAlt, display, choicesLabel, nav, ...language }: ResidentHeaderProps & { nav?: ResidentNavProps }) {
  return (
    <header className="shell-header" data-testid="shell-header">
      <Inline gap="target" justify="between" wrap={false}>
        <Image
          className="shell-logo"
          src={LOGO.src}
          width={LOGO.width}
          height={LOGO.height}
          alt={logoAlt}
          priority
          unoptimized
          data-testid="shell-logo"
        />
        {nav && <ResidentNav {...nav} placement="header" />}
        <div className="shell-header__tools">
          {choicesLabel && <ChoicesTool lang={language.current} label={choicesLabel} />}
          <LanguageControl {...language} />
          <DisplaySettings labels={display} />
        </div>
      </Inline>
    </header>
  );
}
