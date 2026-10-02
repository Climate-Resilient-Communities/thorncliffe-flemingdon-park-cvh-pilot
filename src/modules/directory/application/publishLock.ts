// The one advisory lock that serialises everything that decides what a release holds (S02.05): a publish's claim
// and its completion take it for the length of their transactions, and so does the provider seed, so the seed
// cannot change the providers or the catalogue_load record between a release's snapshot and its commit, nor a
// publish take its snapshot in the middle of a seed.
export const PUBLISH_LOCK_KEY = 4417203115;
