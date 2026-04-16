import type { CsvEnvelope } from "@/lib/csv-report";

interface Props {
  envelope: CsvEnvelope;
  downloadHref: string;
}

// Replaces the markdown/HTML render area on the run page when the agent's
// output_type === "csv". Mirrors the layout in the CSV spec's UX section:
// filename, row/column count, column list (truncated with title tooltip),
// truncation notice when the 500-row cap was hit, then the download button.
export function CsvDownloadBlock({ envelope, downloadHref }: Props) {
  const columnsText = envelope.columns.join(", ");
  return (
    <div className="space-y-3">
      <div>
        <div className="text-base font-semibold break-all">{envelope.filename}</div>
        <div className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
          {envelope.row_count} {envelope.row_count === 1 ? "row" : "rows"} ·{" "}
          {envelope.column_count}{" "}
          {envelope.column_count === 1 ? "column" : "columns"}
        </div>
        <div
          className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]"
          title={columnsText}
        >
          Columns: {columnsText}
        </div>
        {envelope.truncated && (
          <div className="mt-1 text-xs font-medium text-[#7A3F12]">
            Truncated to 500 rows — agent produced more.
          </div>
        )}
      </div>
      <a
        href={downloadHref}
        download={envelope.filename}
        className="btn-primary inline-block no-underline"
      >
        Download CSV
      </a>
    </div>
  );
}
