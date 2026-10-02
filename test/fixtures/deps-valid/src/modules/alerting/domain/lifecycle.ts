import { ALERT_KINDS } from "../../../contracts/alertKinds";
import { messages } from "../../../i18n/catalog";

export const isOpen = (at: Date) => at.getTime() > 0;
export const titles = ALERT_KINDS.map((kind) => `${messages.alert}: ${kind}`);
