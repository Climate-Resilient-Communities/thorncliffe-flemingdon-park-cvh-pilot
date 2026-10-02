// What the steps of the publish job share (S02.05, S03.02): the claim a run holds, and the two ways a step stops it.
import type { CatalogueMismatch, PublishFailureCode } from "./ports";

/** The claim one run holds on the release it is building. */
export interface ReleaseClaim {
  release: number;
  token: string;
  /** The pass number this claim is (1 for a new release). */
  attempts: number;
  resumedFiles: number;
}

/** A step that failed for a reason the Admin is told, and whether another pass can fix it. */
export class PublishStepError extends Error {
  override name = "PublishStepError";
  constructor(
    readonly code: PublishFailureCode,
    readonly retryable: boolean,
    /** What the Admin is told beyond the code: ids and codes of what is wrong, never text from the catalogue. */
    readonly detail: string[] = [],
    readonly catalogue?: CatalogueMismatch,
  ) {
    super(code);
  }
}

/** The job's claim on the release was taken over (or the release was closed): this run stops without touching anything. */
export class LeaseLostError extends Error {
  override name = "LeaseLostError";
}
