/**
 * Styled Excel export via HTML-to-XLS technique.
 * Generates an Excel-compatible HTML table with full inline styling
 * (background colors, text colors, bold, alignment).
 * Opens natively in Excel / LibreOffice Calc as .xls.
 */

export interface ExcelHeader {
  label: string;
  width?: number; // approximate character width
}

export type CellColor = 'green' | 'red' | 'yellow' | 'orange' | 'blue' | 'gray' | 'default';

export interface ExcelCell {
  value: string | number;
  color?: CellColor;
  bold?: boolean;
  align?: 'left' | 'right' | 'center';
}

const COLOR_MAP: Record<CellColor, string> = {
  green:   '#0ecb81',
  red:     '#f6465d',
  yellow:  '#f0b90b',
  orange:  '#f59e42',
  blue:    '#3b8beb',
  gray:    '#848e9c',
  default: '#d4d9e1',
};

function cellHtml(cell: ExcelCell): string {
  const color = COLOR_MAP[cell.color ?? 'default'];
  const bold  = cell.bold ? 'font-weight:bold;' : '';
  const align = `text-align:${cell.align ?? 'left'};`;
  const style = `color:${color};${bold}${align}padding:5px 10px;border:1px solid #2a3545;white-space:nowrap;font-family:Consolas,"SF Mono",monospace;font-size:12px;`;
  return `<td style="${style}">${String(cell.value).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td>`;
}

export function downloadExcel(
  filename: string,
  headers: ExcelHeader[],
  rows: ExcelCell[][],
): void {
  const colGroup = headers.map(h =>
    `<col style="width:${(h.width ?? 14) * 7}px;">`
  ).join('');

  const headerCells = headers.map(h =>
    `<th style="background:#1e2d3d;color:#f0b90b;font-weight:bold;padding:6px 10px;border:1px solid #3a4a5c;white-space:nowrap;font-family:Consolas,'SF Mono',monospace;font-size:12px;text-align:center;">${h.label}</th>`
  ).join('');

  const bodyRows = rows.map((row, i) => {
    const bg = i % 2 === 0 ? '#0e1823' : '#111c27';
    const cells = row.map(cellHtml).join('');
    return `<tr style="background:${bg};">${cells}</tr>`;
  }).join('');

  const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <!--[if gte mso 9]><xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>거래내역</x:Name>
          <x:WorksheetOptions>
            <x:FreezePanes/>
            <x:FrozenNoSplit/>
            <x:SplitHorizontal>1</x:SplitHorizontal>
            <x:TopRowBottomPane>1</x:TopRowBottomPane>
          </x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml><![endif]-->
</head>
<body>
  <table style="border-collapse:collapse;background:#0e1823;">
    <colgroup>${colGroup}</colgroup>
    <thead><tr style="background:#1e2d3d;">${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`.trim();

  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename.endsWith('.xls') ? filename : filename.replace(/\.(xlsx?|csv)$/, '') + '.xls';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
