"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { api, type JournalEntry } from "@/lib/api";
import { API_URL } from "@/lib/config";

export function useWorldConfig() {
  return useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
}

let socket: Socket | undefined;
function getSocket(): Socket {
  socket ??= io(API_URL, { transports: ["websocket"], autoConnect: true });
  return socket;
}

/** World feed: an initial page, then every new journal entry pushed live. */
export function useLiveFeed(limit = 30) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["feed", limit], queryFn: () => api.feed(limit) });
  useEffect(() => {
    const s = getSocket();
    const onEntry = (e: JournalEntry) =>
      qc.setQueryData<JournalEntry[]>(["feed", limit], (prev) => (prev?.some((p) => p.id === e.id) ? prev : [e, ...(prev ?? [])].slice(0, limit)));
    s.on("world", onEntry);
    return () => {
      s.off("world", onEntry);
    };
  }, [qc, limit]);
  return query;
}

/** One Chog's journal, live. Also signals when something new lands so views can refresh. */
export function useLiveJournal(tokenId: string) {
  const qc = useQueryClient();
  const [lastEvent, setLastEvent] = useState(0);
  const query = useQuery({ queryKey: ["journal", tokenId], queryFn: () => api.journal(tokenId) });
  useEffect(() => {
    const s = getSocket();
    const watch = () => s.emit("watch", tokenId);
    watch();
    s.on("connect", watch);
    const onEntry = (e: JournalEntry) => {
      if (e.tokenId !== tokenId) return;
      qc.setQueryData<JournalEntry[]>(["journal", tokenId], (prev) => (prev?.some((p) => p.id === e.id) ? prev : [e, ...(prev ?? [])]));
      setLastEvent(Date.now());
    };
    s.on("journal", onEntry);
    return () => {
      s.off("journal", onEntry);
      s.off("connect", watch);
    };
  }, [qc, tokenId]);
  return { ...query, lastEvent };
}
