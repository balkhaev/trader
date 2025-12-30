"use client";

import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface DeleteConfirmationDialogProps {
  title: string;
  description: string;
  onConfirm: () => void;
  trigger?: ReactNode;
  isLoading?: boolean;
}

export function DeleteConfirmationDialog({
  title,
  description,
  onConfirm,
  trigger,
  isLoading,
}: DeleteConfirmationDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          trigger ?? (
            <Button size="icon" variant="destructive">
              <Trash2Icon className="size-4" />
            </Button>
          )
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            disabled={isLoading}
            onClick={onConfirm}
            variant="destructive"
          >
            {isLoading ? "Удаление..." : "Удалить"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
