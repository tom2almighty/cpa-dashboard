import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, clearKey } from "@/lib/api";
import { LITE } from "@/lib/mode";

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (LITE) clearKey();
      else await api("/api/session", { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["session"], false);
    },
  });
}
