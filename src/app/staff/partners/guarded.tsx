// Every page of the Hub and partner space is the policy action `space.view` (2026-11-07: a Coordinator, a Director read-only and an Admin; an
// Ambassador never sees partner coordination). One wrapper, so each page names its route and title and the refusal reads the same everywhere.
// Responses are no-store like every staff page, and the shell (layout.tsx) owns the <main>.
import type { ReactNode } from "react";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import type { StaffSession } from "../session";
import { pw } from "./words";

export function partnerPage<P>(route: string, title: () => string, render: (session: StaffSession, props: P) => Promise<ReactNode> | ReactNode) {
  return staffPage<P>(
    {
      route,
      access: "hub",
      action: "space.view",
      refused: () => (
        <Screen surface="staff">
          <Stack gap="section-hub">
            <h1 className="hub-wrap">{title()}</h1>
            <p role="alert" className="hub-error">
              {pw("errors.forbiddenView")}
            </p>
          </Stack>
        </Screen>
      ),
    },
    render,
  );
}
