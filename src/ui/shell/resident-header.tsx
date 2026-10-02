import Image from "next/image";
import { Inline } from "../layout/inline";
import { LanguageControl, type LanguageControlProps } from "./language-control";

export type ResidentHeaderProps = LanguageControlProps & {
  logoAlt: string;
};

// The hub logo, scaled to 4x the height it is drawn at (public/brand/hub-logo.png, from the prototype's assets).
const LOGO = { src: "/brand/hub-logo.png", width: 423, height: 136 } as const;

/**
 * C_ResidentHeader: the Hub logo and the language button. Both swap ends in right-to-left because this is an
 * Inline that justifies between, not because of a [dir] rule. The basic-mode switch and "My choices" that the
 * prototype's full variant adds belong to S02.14 and S02.03.
 */
export function ResidentHeader({ logoAlt, ...language }: ResidentHeaderProps) {
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
    </header>
  );
}
