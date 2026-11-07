// The moderation pages' addresses (PRD §6.3), apart from their view so the Hub shell's navigation can name them without loading the directory module.
export const MODERATION_PAGE = "/staff/moderation";
export const REVIEW_PAGE = "/staff/moderation/review";

export const reviewHref = (id: string, decline = false) => `${REVIEW_PAGE}?id=${encodeURIComponent(id)}${decline ? "&decline=1" : ""}`;
