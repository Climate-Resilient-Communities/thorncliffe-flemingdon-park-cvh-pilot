import { englishText } from "@/i18n/text";

/** The name of a type of disruption: the resident catalog's (X-13); fire is "Fire alarm or evacuation", as the 911 rule names it. */
export const typeName = (id: string): string => englishText(id === "fire" ? "x13.fireAlarm" : `x13.${id}`);
