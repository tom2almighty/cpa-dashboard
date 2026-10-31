import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n/context";
import { errorText } from "@/lib/api";
import { accountName, CREDENTIALS_KEY, verifyCredential } from "@/lib/credentials";
import { formatDateTime } from "@/lib/format";
import type { AuthFile } from "@/lib/types";
import { ProviderCard } from "../oauth";

export function RenewalDetails({ target }: { target: AuthFile }) {
  const { t } = useI18n();
  if (!target.renewal_state && !target.recovery_stage && !target.requires_sign_in) return null;
  const dates = [
    ["auth_files.access_token_expires_at", target.access_token_expires_at],
    ["auth_files.next_refresh_after", target.next_refresh_after],
  ] as const;
  return (
    <div className="grid gap-3 rounded-lg border p-3 text-sm">
      {target.requires_sign_in && <p className="text-warning">{t("auth_files.recovery_hint")}</p>}
      <dl className="grid gap-3 sm:grid-cols-2">
        {target.renewal_state && (
          <div>
            <dt className="text-muted-foreground">{t("auth_files.renewal_state")}</dt>
            <dd>{t(`auth_files.renewal_states.${target.renewal_state}`, { defaultValue: target.renewal_state })}</dd>
          </div>
        )}
        {target.recovery_stage && (
          <div>
            <dt className="text-muted-foreground">{t("auth_files.recovery_stage")}</dt>
            <dd>{t(`auth_files.recovery_stages.${target.recovery_stage}`, { defaultValue: target.recovery_stage })}</dd>
          </div>
        )}
        {dates.map(([label, value]) =>
          value ? (
            <div key={label}>
              <dt className="text-muted-foreground">{t(label)}</dt>
              <dd>{formatDateTime(Date.parse(value))}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {target.refresh_error && (
        <p className="break-words text-destructive">
          {[target.refresh_error.code, target.refresh_error.http_status, target.refresh_error.message]
            .filter(Boolean)
            .join(" / ")}
        </p>
      )}
    </div>
  );
}

export function RecoveryDialog({ target, onClose }: { target: AuthFile; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("auth_files.sign_in_again")}</DialogTitle>
          <DialogDescription>{accountName(target)}</DialogDescription>
        </DialogHeader>
        <RenewalDetails target={target} />
        <ProviderCard
          provider={{ id: "codex", name: "Codex", hintKey: "auth_files.targeted_login_hint" }}
          target={target}
          onComplete={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

export function VerifyDialog({ target, onClose }: { target: AuthFile; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [model, setModel] = useState("");
  const verify = useMutation({
    mutationFn: () => verifyCredential(target, model),
    onSuccess: (result) => {
      if (!result.verified) return;
      toast.success(t("auth_files.verify_success"));
      onClose();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY }),
    meta: { quiet: true },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !verify.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("auth_files.verify_credential")}</DialogTitle>
          <DialogDescription>{t("auth_files.verify_hint", { name: accountName(target) })}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!verify.isPending) verify.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="verify-model">{t("auth_files.verify_model")}</Label>
            <Input
              id="verify-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={verify.isPending}
            />
          </div>
          {(verify.isError || verify.data?.verified === false) && (
            <p role="alert" className="text-sm text-destructive">
              {verify.isError ? errorText(verify.error) : t("auth_files.verify_incomplete")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" disabled={verify.isPending} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={verify.isPending}>
              {verify.isPending && <Spinner />}
              {t("auth_files.verify_credential")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
