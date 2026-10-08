import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GATE_PAGES } from "@/contracts/staffAuth";
import { englishText } from "@/i18n/text";
import { publicStaffPage } from "../guard";
import { StaffSignInView } from "./StaffSignInView";

export const metadata: Metadata = { title: englishText("staff.signIn.title") };

/** Staff sign-in (S01.07). Public; someone already signed in goes to the page of their setup gate. */
export default publicStaffPage("/staff/sign-in", (session) => {
  if (session) redirect(GATE_PAGES[session.gate]);
  return <StaffSignInView />;
});
