import openpyxl

wb = openpyxl.load_workbook(r'd:\Code\Vbird_ESI\other\表格模板.xlsx')

with open(r'd:\Code\Vbird_ESI\other\xlsx_dump.txt', 'w', encoding='utf-8') as f:
    f.write(f"Sheet names: {wb.sheetnames}\n\n")
    for name in wb.sheetnames:
        ws = wb[name]
        f.write(f"\n{'='*60}\n")
        f.write(f"Sheet: {name} (rows={ws.max_row}, cols={ws.max_column})\n")
        f.write(f"{'='*60}\n")
        
        # Merged cells
        if ws.merged_cells.ranges:
            f.write(f"Merged cells: {[str(m) for m in ws.merged_cells.ranges]}\n")
        
        # Column widths
        for col_letter, dim in ws.column_dimensions.items():
            if dim.width:
                f.write(f"  Col {col_letter} width: {dim.width}\n")
        
        # Data rows (first 20)
        for ri, row in enumerate(ws.iter_rows(min_row=1, max_row=min(ws.max_row, 25)), 1):
            vals = []
            for c in row:
                if c.value is not None:
                    vals.append(f"{c.coordinate}={c.value}")
            if vals:
                f.write(f"  Row {ri}: {' | '.join(vals)}\n")

print("Done! Exported to xlsx_dump.txt")
