// src/platform must not import any module, even through its index.ts.
import { recordEvent } from "../modules/audit";

export const log = () => recordEvent();
