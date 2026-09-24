import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

const ROWS = ["a", "b", "c", "d", "e"];

export function SkeletonRows({ columns }: { columns: number }) {
  return ROWS.map((key) => (
    <TableRow key={key}>
      <TableCell colSpan={columns}>
        <Skeleton className="h-5" />
      </TableCell>
    </TableRow>
  ));
}

export function EmptyRow({ columns, children }: { columns: number; children: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={columns} className="h-32 text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}
