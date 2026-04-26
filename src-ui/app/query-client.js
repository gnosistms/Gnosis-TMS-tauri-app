import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/query-core";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export const glossaryKeys = {
  all: ["glossaries"],
  byTeam: (teamId) => ["glossaries", teamId ?? null],
};

export const projectKeys = {
  all: ["projects"],
  byTeam: (teamId) => ["projects", teamId ?? null],
};

export function subscribeQueryObserver(options, onResult) {
  const observer = new QueryObserver(queryClient, options);
  const unsubscribe = observer.subscribe(onResult);
  onResult(observer.getCurrentResult());
  return {
    observer,
    unsubscribe,
  };
}

export function createMutationObserver(options) {
  return new MutationObserver(queryClient, options);
}
