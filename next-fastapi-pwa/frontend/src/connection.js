/** Browser events are hints. Only a successful, uncached API probe confirms online. */
export function createConnectionMonitor(api, onChange, options = {}) {
    const onlineHint = options.onlineHint || (() => navigator.onLine);
    const fetcher = options.fetcher || fetch;
    let status = 'checking';
    let generation = 0;
    let controller;
    let pending;
    let disposed = false;
    const publish = (next) => {
        if (disposed || next === status)
            return;
        status = next;
        onChange(next);
    };
    return {
        check() {
            if (disposed)
                return Promise.resolve(false);
            if (!onlineHint()) {
                generation++;
                controller?.abort();
                pending = undefined;
                publish('offline');
                return Promise.resolve(false);
            }
            // Frequent checks share a slow probe instead of repeatedly aborting it.
            if (pending)
                return pending;
            const current = ++generation;
            const requestController = new AbortController();
            controller = requestController;
            const timer = setTimeout(() => requestController.abort(), options.timeout ?? 4000);
            const probe = async () => {
                try {
                    const response = await fetcher(`${api}/health`, { cache: 'no-store', signal: requestController.signal });
                    if (!response.ok || (await response.json()).status !== 'ok')
                        throw new Error('API unavailable');
                    if (disposed || current !== generation)
                        return false;
                    if (!onlineHint()) {
                        publish('offline');
                        return false;
                    }
                    publish('online');
                    return true;
                }
                catch {
                    if (!disposed && current === generation)
                        publish(onlineHint() ? 'unavailable' : 'offline');
                    return false;
                }
                finally {
                    clearTimeout(timer);
                }
            };
            pending = probe().finally(() => {
                if (current === generation)
                    pending = undefined;
            });
            return pending;
        },
        dispose() { disposed = true; generation++; controller?.abort(); },
    };
}
