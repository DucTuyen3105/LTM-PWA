// Registration belongs to the page. Fetch/cache handling belongs to the worker.
export async function setupPwa(onLog) {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations
      .filter(registration => registration.active?.scriptURL === `${location.origin}/sw.js`)
      .map(registration => registration.unregister()));
    return;
  }
  const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  const worker = registration.installing || registration.waiting;
  if (worker && worker.state !== 'activated') {
    await new Promise((resolve, reject) => {
      const changed = () => {
        if (worker.state === 'activated' || worker.state === 'redundant') {
          worker.removeEventListener('statechange', changed);
          worker.state === 'activated' ? resolve() : reject(new Error('Không chuẩn bị được cache offline.'));
        }
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
  }
  await navigator.serviceWorker.ready;
  onLog('PWA sẵn sàng.');
}
