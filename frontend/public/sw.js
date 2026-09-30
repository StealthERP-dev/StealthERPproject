// Pass-through service worker: caches nothing, never touches a response.
// It exists only so Android Chrome treats the app as installable (WebAPK);
// the fetch handler is intentionally empty.
self.addEventListener("fetch", () => {});
