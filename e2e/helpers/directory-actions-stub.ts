// Stands in for src/app/staff/directory/actions.ts in the screenshot harness (e2e/helpers/layout-fixture.ts), which
// renders the Publish directory button without a server. The real action is a "use server" module that publishes to the
// database and the store; this one answers with whatever the test put on the page (window.__directoryAnswer), already
// built from the real catalog words, so the screenshots can show a done message and a failure. Only the harness uses
// this file.
import type { PublishState } from "../../src/app/staff/directory/publishRelease";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the same (previous state, form) pair as the real action
export async function publishDirectoryAction(_previous: PublishState, _form: FormData): Promise<PublishState> {
  return (globalThis as unknown as { __directoryAnswer?: PublishState }).__directoryAnswer ?? { status: "idle" };
}
