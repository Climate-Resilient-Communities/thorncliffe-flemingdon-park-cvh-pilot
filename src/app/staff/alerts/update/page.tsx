import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { staffPage } from "../../guard";
import { forbiddenView } from "../composer/ComposerPage";
import type { ComposerQuery } from "../composer/loadComposer";
import { UpdatePage } from "./UpdatePage";

export const metadata: Metadata = { title: englishText("staff.compose.updateTitle") };

/**
 * "Add an update" (O-14, S05.01): with `?alert=<id>` the start of an update to a running alert (the thread's audience, types and languages carried over,
 * a required phase, a valid-until that defaults to the previous entry's choice); with `?alert=<id>&entry=<id>` the composer of the draft it made. Submit,
 * approval, translation and freezing are the other composers' exactly. The policy action `alert.author_wide` (Coordinators and Admins). Responses are
 * no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage({ route: "/staff/alerts/update", access: "hub", action: "alert.author_wide", refused: forbiddenView }, async (_session, props: { searchParams?: Promise<ComposerQuery> }) => (
  <UpdatePage flavor="update" query={(await props.searchParams) ?? {}} />
));
