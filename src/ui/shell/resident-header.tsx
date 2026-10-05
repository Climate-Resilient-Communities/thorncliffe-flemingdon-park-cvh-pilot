import Image from "next/image";
import { BasicSwitch, type BasicSwitchProps } from "../basic";
import { Inline } from "../layout/inline";
import { LanguageControl, type LanguageControlProps } from "./language-control";

export type ResidentHeaderProps = LanguageControlProps & {
  logoAlt: string;
  /** The words of X-07, the basic-mode switch under the logo row. */
  basic: BasicSwitchProps["labels"];
};

// The hub logo, scaled to 4x the height it is drawn at (public/brand/hub-logo.png, from the prototype's assets).
const LOGO = { src: "/brand/hub-logo.png", width: 423, height: 136 } as const;

/**
 * C_ResidentHeader: the Hub logo and the language button, and under them the basic-mode switch (X-07, S02.14). The logo
 * and the button swap ends in right-to-left because this is an Inline that justifies between, not because of a [dir]
 * rule. "My choices", the prototype's second tool beside the switch, is the link of R-03 for now (S02.03).
 */
export function ResidentHeader({ logoAlt, basic, ...language }: ResidentHeaderProps) {
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
        <LanguageControl {...language} />
      </Inline>
      <div className="shell-tools">
        <BasicSwitch labels={basic} />
      </div>
    </header>
  );
}
