// Nexus IQ error type. Every thrown error in server code is a NexusIQError so
// route handlers can map `code` onto the API error envelope.
//
// Optional 4th argument: { status, cause }
//   - status: explicit HTTP status for this error. The router resolves the
//     final status as: explicit `status` > its per-code map > 400.
//   - cause: the underlying error, stored as the standard Error#cause.
export class NexusIQError extends Error {
  constructor(code, message, details = {}, { status, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "NexusIQError";
    this.code = code;
    this.details = details;
    if (status !== undefined) this.status = status;
  }
}
