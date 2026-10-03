// scripts/search-test-set: counting the vendor calls of a run (S03.07). The search use case does not say which call a
// vendor refused with HTTP 429 (its adapters keep only a code), and the run needs that to report a rate limit as its own
// outcome instead of scoring it as a miss, and to count every call against the usage allowance. So the Cohere clients the
// adapters are given are wrapped here, at the vendor boundary: each call is counted when it starts, by model, and settled as
// answered (with the tokens the vendor reported), refused for a limit, failed, or cancelled by the search's own deadline.
// The wrapper changes no request and no answer, and keeps nothing of either: no text, and not the vendor's words, only a class.
import type { CohereEmbedClient } from "@/modules/directory";
import { classifyCohereError, isLimitFailure, type CohereChatClient } from "@/modules/translation";
import type { KindUsage, ModelUsage, VendorFailure, VendorUsage } from "@/contracts/searchTuning";

/** What one question did at the vendors: the calls it made and the ones that failed. */
export interface QuestionTrace {
  embedding: number;
  translation: number;
  /** The model of each translation call, in order: two when the routed model was refused and the fallback model was tried. */
  translationModels: string[];
  failures: VendorFailure[];
}

const emptyModel = (): ModelUsage => ({ calls: 0, rate_limited: 0, failed: 0, aborted: 0, tokens: 0, unreported_calls: 0 });
const emptyKind = (): KindUsage => ({ ...emptyModel(), by_model: {} });
const emptyTrace = (): QuestionTrace => ({ embedding: 0, translation: 0, translationModels: [], failures: [] });

export interface VendorMeter {
  embed: CohereEmbedClient;
  chat: CohereChatClient;
  /** The calls of the whole run so far, by kind and by model. */
  usage(): VendorUsage;
  /** Calls made so far, of both kinds. */
  callsMade(): number;
  /** What was called since the last `take()`: one question's calls. A call that settles later is still counted in `usage()`. */
  take(): QuestionTrace;
}

/** Wraps the two clients (they are the same SDK client in production). */
export function meterVendor(clients: { embed: CohereEmbedClient; chat: CohereChatClient }): VendorMeter {
  const usage: VendorUsage = { embedding: emptyKind(), translation: emptyKind() };
  let trace = emptyTrace();
  let calls = 0;

  function begin(kind: "embedding" | "translation", model: string) {
    const mine = trace;
    const kindUsage = usage[kind];
    const modelUsage = (kindUsage.by_model[model] ??= emptyModel());
    const both = [kindUsage, modelUsage];
    for (const u of both) u.calls += 1;
    mine[kind] += 1;
    if (kind === "translation") mine.translationModels.push(model);
    calls += 1;
    return {
      answered(tokens: number | null) {
        for (const u of both) {
          if (tokens === null) u.unreported_calls += 1;
          else u.tokens += tokens;
        }
      },
      failed(error: unknown, signal: AbortSignal | undefined) {
        const failureClass: VendorFailure["class"] = signal?.aborted ? "aborted" : isLimitFailure(classifyCohereError(error)) ? "limit" : "error";
        for (const u of both) {
          if (failureClass === "aborted") u.aborted += 1;
          else if (failureClass === "limit") u.rate_limited += 1;
          else u.failed += 1;
        }
        mine.failures.push({ kind, model, class: failureClass });
      },
    };
  }

  const embed: CohereEmbedClient = {
    v2: {
      async embed(request, options) {
        const call = begin("embedding", request.model);
        try {
          const response = await clients.embed.v2.embed(request, options);
          const tokens = response?.meta?.billedUnits?.inputTokens;
          call.answered(typeof tokens === "number" ? tokens : null);
          return response;
        } catch (error) {
          call.failed(error, options.abortSignal);
          throw error;
        }
      },
    },
  };

  const chat: CohereChatClient = {
    v2: {
      async chat(request, options) {
        const call = begin("translation", request.model);
        try {
          const response = await clients.chat.v2.chat(request, options);
          const billed = response?.usage?.billedUnits;
          const reported = typeof billed?.inputTokens === "number" || typeof billed?.outputTokens === "number";
          call.answered(reported ? (billed?.inputTokens ?? 0) + (billed?.outputTokens ?? 0) : null);
          return response;
        } catch (error) {
          call.failed(error, options.abortSignal);
          throw error;
        }
      },
    },
  };

  return {
    embed,
    chat,
    usage: () => structuredClone(usage),
    callsMade: () => calls,
    take() {
      const done = trace;
      trace = emptyTrace();
      return done;
    },
  };
}
