// The dispatcher's use case takes a submitter as data (a port), never the adapter: this import of a non-Twilio adapter is allowed.
import { fakeStore } from "../adapters/fakeStore";

export const dispatch = (submit: (body: string) => number) => fakeStore().map(submit);
