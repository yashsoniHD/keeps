import type { NoteAccent } from "@/lib/note-meta";

// Firestore can't store arrays-in-arrays, so the backend wraps each row as {cells: [...]}
// at the write boundary (services/firebase.py firestore_safe). Both shapes render here.
export interface TableData {
  columns: string[];
  rows: (string[] | { cells: string[] })[];
}

function rowCells(row: string[] | { cells: string[] }): string[] {
  return Array.isArray(row) ? row : (row.cells ?? []);
}

// A structured data table with an accent-tinted header row. Extracted from GenericNote so any
// template can render a note's `data.table` block identically.
export function DataTable({ table, accent }: { table: TableData; accent: NoteAccent }) {
  if (!table.columns?.length) return null;
  return (
    <section className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className={accent.soft}>
            {table.columns.map((col, i) => (
              <th key={i} className="px-4 py-3 text-left font-medium text-ink">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {(table.rows ?? []).map((row, i) => (
            <tr key={i}>
              {rowCells(row).map((cell, j) => (
                <td key={j} className="px-4 py-3 text-ink">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
