// What an Ambassador's home asks of the check-in rounds (S08.01, A-01): whether a round is open for the floors they cover, and how many requests it has
// for them. The rounds themselves (the `checkin` rows, `ensureRound`) are built by the stories that follow in epic E08; until a round exists the answer is
// "no open round", and the home says so. The reader takes the person's current assignments (identity's `assignmentsOf`), never an id from a request.
export interface RoundAssignment {
  rsn: string;
  /** Floor ids, or null for every floor of the building. */
  floorIds: readonly string[] | null;
}

/** An open round for the person's floors: how many check-in requests are theirs. */
export interface RoundSummary {
  requests: number;
}

export interface RoundSummaryReader {
  /** The open round for these assignments, or null when none is open. */
  openFor(assignments: readonly RoundAssignment[]): Promise<RoundSummary | null>;
}

/** No round exists yet: nothing is open for anyone. */
export const NO_OPEN_ROUNDS: RoundSummaryReader = { openFor: async () => null };
