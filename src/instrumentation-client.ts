// Runs in the browser before the app's own code (Next.js instrumentation-client), on every page. The Content-Security-Policy
// (src/platform/config/securityHeaders.ts, SIT F3) allows no eval; zod tests whether it may compile its schemas with
// `Function("")` the first time it parses an object, which the browser reports as a policy violation. Zod's own switch skips the
// test (and the compilation): the schemas the pages parse are small, and they parse the same without it.
import { z } from "zod";

z.config({ jitless: true });
