// One error type for everything a client can get wrong, carrying the HTTP
// status and the OpenAI error envelope alongside the message.
//
// WHY: the OpenAI SDKs parse `{"error": {"message", "type", "param", "code"}}`
// and surface `error.message` to the user. Anything else (a bare string, an
// Express stack trace) shows up in client code as an unhelpful "unknown error",
// so every failure path in this server ends here.
//
// Built with Claude Code.

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} message human-readable, shown verbatim by the OpenAI SDKs
   * @param {object} [opts]
   * @param {string} [opts.type]  OpenAI error type ("invalid_request_error", ...)
   * @param {string} [opts.code]  machine-readable short code
   * @param {string} [opts.param] offending field name
   * @param {object} [opts.headers] extra response headers (e.g. Retry-After)
   */
  constructor(status, message, { type, code, param, headers } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type || (status >= 500 ? 'server_error' : 'invalid_request_error');
    this.code = code || null;
    this.param = param || null;
    this.headers = headers || {};
  }

  /** The response body, as the OpenAI API shapes it. */
  toBody() {
    return { error: { message: this.message, type: this.type, param: this.param, code: this.code } };
  }
}

/** 400 */
export const badRequest = (message, opts) => new ApiError(400, message, opts);
/** 401 */
export const unauthorized = (message = 'missing or invalid API key') =>
  new ApiError(401, message, { type: 'invalid_request_error', code: 'invalid_api_key' });
/** 404 */
export const notFound = (message) => new ApiError(404, message, { code: 'not_found' });
/** 413 */
export const tooLarge = (message) => new ApiError(413, message, { code: 'payload_too_large' });
/** 429 */
export const tooManyRequests = (message, retryAfterSec) =>
  new ApiError(429, message, { code: 'rate_limit_exceeded', headers: { 'Retry-After': String(retryAfterSec) } });
/** 501 -- asked for something this pipeline structurally cannot do. */
export const notImplemented = (message) =>
  new ApiError(501, message, { type: 'invalid_request_error', code: 'not_implemented' });
/** 503 */
export const unavailable = (message) => new ApiError(503, message, { code: 'unavailable' });
/** 504 */
export const timeout = (message) => new ApiError(504, message, { code: 'timeout' });
