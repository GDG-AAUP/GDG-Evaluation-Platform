/**
 * Error thrown by every service call (mock or HTTP).
 *   status 0   -> network failure / server unreachable
 *   status 400 -> validation error        status 401 -> not authenticated
 *   status 403 -> not allowed             status 404 -> not found
 *   status 409 -> conflict with a business rule
 * `message` is always a user-facing Arabic sentence.
 */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}
