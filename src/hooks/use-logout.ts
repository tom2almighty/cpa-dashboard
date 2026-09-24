import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/session", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["session"], false);
    },
  });
}
