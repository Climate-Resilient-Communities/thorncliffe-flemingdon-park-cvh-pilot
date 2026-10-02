import Link from "next/link";
import { ResidentText } from "../text/resident-text";
import "./choices.css";

/** The way in to R-34 from a screen: a plain link to "What I have told the CVH". */
export function ChoicesLink({ href, children }: { href: string; children: string }) {
  return (
    <Link className="choice-btn choice-btn--secondary tap" href={href} data-testid="choices-link">
      <ResidentText>{children}</ResidentText>
    </Link>
  );
}
