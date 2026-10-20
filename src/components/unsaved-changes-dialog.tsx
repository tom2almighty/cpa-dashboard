import type { Blocker } from "react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/i18n/context";

export function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  const { t } = useI18n();

  return (
    <AlertDialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("common.unsaved_title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("common.unsaved_desc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.keep_editing")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
            {t("common.discard_and_leave")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
