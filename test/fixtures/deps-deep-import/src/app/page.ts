// app --> alerting is declared, but only alerting's index.ts may be imported.
import { isOpen } from "../modules/alerting/domain/lifecycle";

export const render = () => isOpen(new Date());
