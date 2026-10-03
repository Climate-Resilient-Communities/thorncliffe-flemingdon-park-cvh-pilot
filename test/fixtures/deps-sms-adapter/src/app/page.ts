// app --> messaging is declared, but a route may not take an SMS adapter either.
import { recordInsteadOfSending } from "../modules/messaging/adapters/fakeSms";

export const page = () => recordInsteadOfSending("hello");
