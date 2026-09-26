import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clearKey } from "@/lib/api";

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => clearKey(),
    onSuccess: () => {
      queryClient.setQueryData(["session"], false);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    },
  });
}
