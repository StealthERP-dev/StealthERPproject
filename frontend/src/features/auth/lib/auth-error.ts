// One auth error taxonomy, four strings, one lookup — mirrors
// use-place-order.ts's PlaceOrderError/orderErrorMessage pattern exactly.
//
// Imports nothing — not a type, not the `@/` alias — so `node --test` can
// load this file directly, the same zero-project-import convention
// `phone.ts`, `slug.ts`, `src/lib/analytics/log-event-core.ts` and
// `visitor-id.ts` already establish (IN-03: these constants used to live in
// `../constants.ts` and were imported here with an explicit `.ts`
// extension, which required `allowImportingTsExtensions: true` project-wide
// in tsconfig.json just for this one cross-file import. Consumed only by
// this file, so they were moved here and the tsconfig flag reverted).
//
// Copy is UI-SPEC's Copywriting Contract, verbatim, character for character
// — this is the approved contract, not a paraphrase.

export const AUTH_ERROR_CODES = [
  "invalid_credentials",
  "locked_out",
  "duplicate_phone",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: "Wrong mobile number or PIN",
  locked_out: "Too many wrong PINs. Try again in 15 minutes.",
  duplicate_phone: "This number already has a shop — open it instead",
};

export const GENERIC_AUTH_ERROR = "Something went wrong. Try again.";

function isAuthErrorCode(value: string): value is AuthErrorCode {
  return (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

export class AuthError extends Error {
  readonly code: AuthErrorCode | "unknown";

  constructor(message: string) {
    super(message);
    this.name = "AuthError";
    this.code = isAuthErrorCode(message) ? message : "unknown";
  }
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthError && error.code !== "unknown") {
    return AUTH_ERROR_MESSAGES[error.code];
  }
  return GENERIC_AUTH_ERROR;
}
