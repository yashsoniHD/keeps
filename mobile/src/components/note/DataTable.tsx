import { View, Text } from "react-native";
import type { NoteAccent } from "@/lib/note-meta";

// Firestore can't store arrays-in-arrays, so the backend wraps each row as {cells: [...]} at the
// write boundary. Both shapes render here. Port of frontend/src/components/note/DataTable.tsx —
// RN has no <table>, so the grid is flex rows with equal-flex cells.
export interface TableData {
  columns: string[];
  rows: (string[] | { cells: string[] })[];
}

function rowCells(row: string[] | { cells: string[] }): string[] {
  return Array.isArray(row) ? row : (row.cells ?? []);
}

export function DataTable({ table, accent }: { table: TableData; accent: NoteAccent }) {
  if (!table.columns?.length) return null;
  return (
    <View className="overflow-hidden rounded-2xl border border-border">
      <View className={`flex-row ${accent.soft}`}>
        {table.columns.map((col, i) => (
          <Text key={i} className="flex-1 px-4 py-3 text-sm font-medium text-ink">
            {col}
          </Text>
        ))}
      </View>
      {(table.rows ?? []).map((row, i) => (
        <View key={i} className="flex-row border-t border-border">
          {rowCells(row).map((cell, j) => (
            <Text key={j} className="flex-1 px-4 py-3 text-sm text-ink">
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
