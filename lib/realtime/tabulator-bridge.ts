/** Module-level bridge so SSE can live outside the live snapshot provider tree. */

type RefreshFn = () => Promise<void>;

let refreshSnapshot: RefreshFn | null = null;

export function registerTabulatorSnapshotRefresh(fn: RefreshFn) {
  refreshSnapshot = fn;
  return () => {
    if (refreshSnapshot === fn) refreshSnapshot = null;
  };
}

export function requestTabulatorSnapshotRefresh() {
  void refreshSnapshot?.();
}
