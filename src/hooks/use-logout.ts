import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clearKey } from "@/lib/api";

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => clearKey(),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["session"], false);
    },
  });
}
