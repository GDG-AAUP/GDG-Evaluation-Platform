// Tiny bridge so low-level code (http client / mock runtime) can tell the UI
// that the session is no longer valid, without importing React.

let handler = null;

export function setUnauthorizedHandler(fn) {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
}

export function notifyUnauthorized() {
  if (handler) handler();
}
