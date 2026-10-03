// Another module taking the words of a text message to put a body together itself: not allowed.
import { smsStrings } from "../../../i18n/smsStrings";

export const notify = (lang: string) => smsStrings(lang).stop;
