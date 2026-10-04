"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { startRefresh } from "./refresh";

/** Renders the page again from the server every `seconds` (S06.09), so the counts of an alert that is being sent keep moving without a reload. Draws nothing. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => startRefresh(() => router.refresh(), seconds), [router, seconds]);
  return null;
}
