import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import StopCard from "./StopCard";
import type { Stop } from "../../../drizzle/schema";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSortable } from "@dnd-kit/sortable";

interface SortableStopCardProps {
  stop: Stop;
  searchQuery?: string;
  onTap: (stop: Stop) => void;
  isDragMode: boolean;
  isAdmin?: boolean;
  onDelete?: (stopId: number) => Promise<void>;
}

export default function SortableStopCard({
  stop,
  searchQuery,
  onTap,
  isDragMode,
  isAdmin = false,
  onDelete,
}: SortableStopCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stop.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
    zIndex: isDragging ? 50 : undefined,
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(stop.id);
      setShowDeleteDialog(false);
    } catch (error) {
      console.error("Delete failed:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div ref={setNodeRef} style={style} className="flex items-stretch gap-2">
        {/* Drag handle — only visible in drag mode, admin-only feature */}
        {isDragMode && isAdmin && (
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="flex items-center justify-center w-8 shrink-0 rounded-xl bg-muted/60 border border-border text-muted-foreground touch-none cursor-grab active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            <GripVertical size={16} />
          </button>
        )}

        {/* Stop card — tap-to-edit disabled while dragging */}
        <div className="flex-1 min-w-0">
          <StopCard
            stop={stop}
            searchQuery={searchQuery}
            onTap={isDragMode ? undefined : onTap}
            isAdmin={isAdmin}
          />
        </div>

        {/* Delete button — only visible in drag mode, admin-only feature */}
        {isDragMode && isAdmin && onDelete && (
          <button
            onClick={() => setShowDeleteDialog(true)}
            disabled={isDeleting}
            className="flex items-center justify-center w-8 shrink-0 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
            aria-label="Delete stop"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete this stop?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. Stop {stop.stopOrder} will be permanently removed from the route.
          </AlertDialogDescription>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
