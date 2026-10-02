// src/contracts must not import any module: it is safe to import in client code.
import { isOpen } from "../modules/alerting";

export const wire = (at: Date) => ({ v: 1, open: isOpen(at) });
