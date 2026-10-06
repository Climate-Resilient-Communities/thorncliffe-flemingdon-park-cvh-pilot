// The check-in request's parts (S08.05): the section the sign-up form and the edit page share, the answer it gets, and their rules. App code
// imports from "@/ui/checkin". Separate from "@/ui" for the same reason as "@/ui/signup": it pulls in Next's link component and next-intl.
export { CheckinAnswerNote } from "./answer-note";
export { CheckinFields, type CheckinFieldsProps } from "./checkin-fields";
export { NO_REQUEST, draftOf, moved, needsConsent, problemOf, requestBody, whereOptions, type CheckinDraft, type HeldRequest, type WhereOption } from "./request";
