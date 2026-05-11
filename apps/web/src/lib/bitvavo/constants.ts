/** Origin only — private signed paths use `${BITVAVO_REST_ORIGIN}${requestPath}` with `requestPath` starting at `/v2`. */
export const BITVAVO_REST_ORIGIN = "https://api.bitvavo.com";

/** Base URL for public GET `/v2/...` endpoints (markets, assets, …). */
export const BITVAVO_REST_V2_BASE = `${BITVAVO_REST_ORIGIN}/v2`;
