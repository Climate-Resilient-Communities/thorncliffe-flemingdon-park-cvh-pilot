// src/i18n must not import any module: every module may import it.
import { monthToDateCents } from "../modules/spend";

export const spendLabel = () => `${monthToDateCents()}`;
