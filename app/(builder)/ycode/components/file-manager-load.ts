export interface AssetLoadGuard {
  start(supersede: boolean): number | null;
  isCurrent(requestId: number): boolean;
  isLoading(): boolean;
  finish(requestId: number): boolean;
}

export function createAssetLoadGuard(): AssetLoadGuard {
  let activeRequestId = 0;
  let loading = false;

  return {
    start(supersede) {
      if (loading && !supersede) return null;

      activeRequestId += 1;
      loading = true;
      return activeRequestId;
    },

    isCurrent(requestId) {
      return loading && requestId === activeRequestId;
    },

    isLoading() {
      return loading;
    },

    finish(requestId) {
      if (requestId !== activeRequestId) return false;

      loading = false;
      return true;
    },
  };
}
