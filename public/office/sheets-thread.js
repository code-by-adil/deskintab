// Calc operations via LibreOffice UNO. Loaded on the same ZetaJS worker as Writer.
// API references and current limits are documented in docs/sheets.md.
'use strict';
Module.desktopSheets = (zeta, context, property, error) => {
	const css = zeta.uno.com.sun.star;
	function sheet(model, name) {
		if (!name) return model.getCurrentController().getActiveSheet();
		if (!model.getSheets().hasByName(name))
			throw error('SHEET_MISSING', 'Read the workbook for available sheet names.');
		return model.getSheets().getByName(name);
	}
	function column(index) {
		let name = '';
		for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
			name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
		return name;
	}
	const addressText = (a) =>
		`${column(a.StartColumn)}${a.StartRow + 1}:${column(a.EndColumn)}${a.EndRow + 1}`;
	function setCells(target, values) {
		values.forEach((row, r) =>
			row.forEach((value, c) => {
				const cell = target.getCellByPosition(c, r);
				if (value === null) cell.setFormula('');
				else if (typeof value === 'number') cell.setValue(value);
				else if (typeof value === 'string') cell.setString(value);
				else cell.setFormula(value.formula);
			}),
		);
	}
	function selection(model) {
		try {
			const selected = model.getCurrentController().getSelection();
			const a = selected.getRangeAddress();
			return { sheet: model.getSheets().getByIndex(a.Sheet).getName(), range: addressText(a) };
		} catch {
			return null;
		}
	}
	function create(model, sheets) {
		const collection = model.getSheets();
		// Preserve one default sheet while renaming it; then add the remaining sheets.
		while (collection.getCount() > 1)
			collection.removeByName(collection.getByIndex(collection.getCount() - 1).getName());
		sheets.forEach((data, i) => {
			if (i === 0) collection.getByIndex(0).setName(data.name);
			else collection.insertNewByName(data.name, i);
			const target = collection.getByName(data.name);
			setCells(
				target.getCellRangeByPosition(0, 0, data.values[0].length - 1, data.values.length - 1),
				data.values,
			);
		});
		model.calculateAll();
		sheets.forEach((data) =>
			collection
				.getByName(data.name)
				.getCellRangeByPosition(0, 0, data.values[0].length - 1, data.values.length - 1)
				.getColumns()
				.setPropertyValue('OptimalWidth', true),
		);
		model.getCurrentController().setActiveSheet(collection.getByIndex(0));
		model.getCurrentController().select(collection.getByIndex(0).getCellRangeByName('A1'));
	}
	function read(model, input) {
		const target = sheet(model, input.sheet);
		const selected = selection(model);
		const requested = input.range || 'A1:J30';
		const range = target.getCellRangeByName(requested);
		const a = range.getRangeAddress();
		const cells = [];
		let chars = 0,
			truncated = false;
		for (let r = a.StartRow; r <= a.EndRow; r++) {
			const row = [];
			for (let c = a.StartColumn; c <= a.EndColumn; c++) {
				const cell = target.getCellByPosition(c, r);
				const kind = cell.getType();
				const type =
					kind === css.table.CellContentType.EMPTY
						? 'empty'
						: kind === css.table.CellContentType.VALUE
							? 'number'
							: kind === css.table.CellContentType.FORMULA
								? 'formula'
								: 'text';
				const full = cell.getString(),
					fullFormula = type === 'formula' ? cell.getFormula() : null;
				const remaining = Math.max(0, Math.min(5000, 100000 - chars));
				const text = full.slice(0, remaining);
				chars += text.length;
				const formula = fullFormula?.slice(0, Math.max(0, Math.min(5000, 100000 - chars))) ?? null;
				chars += formula?.length || 0;
				if (text.length !== full.length || formula?.length !== fullFormula?.length)
					truncated = true;
				row.push({
					cell: `${column(c)}${r + 1}`,
					type,
					text,
					value: type === 'number' || type === 'formula' ? cell.getValue() : null,
					formula,
					error: cell.getError(),
				});
			}
			cells.push(row);
		}
		const charts = target.getCharts();
		const names = charts.getElementNames();
		return {
			sheet: target.getName(),
			range: addressText(a),
			selection: selected,
			sheets: model.getSheets().getElementNames(),
			cells,
			truncated: truncated || names.length > 50,
			charts: names
				.slice(0, 50)
				.map((name) => ({ name, ranges: charts.getByName(name).getRanges().map(addressText) })),
		};
	}
	function edit(model, op) {
		const target = sheet(model, op.sheet),
			range = target.getCellRangeByName(op.range);
		let format;
		if (op.numberFormat !== undefined) {
			const formats = model.getNumberFormats();
			const locale = new css.lang.Locale({ Language: 'en', Country: 'US' });
			format = formats.queryKey(op.numberFormat, locale, false);
			if (format === -1) format = formats.addNew(op.numberFormat, locale);
		}
		const undo = model.getUndoManager();
		undo.enterUndoContext(op.type === 'cells' ? 'Edit workbook cells' : 'Format workbook cells');
		try {
			if (op.type === 'cells') setCells(range, op.values);
			else {
				if (op.bold !== undefined)
					range.setPropertyValue(
						'CharWeight',
						new zeta.Any(
							zeta.type.float,
							op.bold ? css.awt.FontWeight.BOLD : css.awt.FontWeight.NORMAL,
						),
					);
				if (op.background !== undefined)
					range.setPropertyValue('CellBackColor', parseInt(op.background.slice(1), 16));
				if (op.color !== undefined)
					range.setPropertyValue('CharColor', parseInt(op.color.slice(1), 16));
				if (format !== undefined) range.setPropertyValue('NumberFormat', format);
				if (op.autoFit) range.getColumns().setPropertyValue('OptimalWidth', true);
			}
		} finally {
			undo.leaveUndoContext();
		}
		model.calculateAll();
		// Select only deliberate edits, never reads: agent inspection must preserve human selection.
		model.getCurrentController().setActiveSheet(target);
		model.getCurrentController().select(range);
	}
	function chart(model, input) {
		const target = sheet(model, input.sheet),
			range = target.getCellRangeByName(input.range);
		const charts = target.getCharts();
		if (charts.hasByName(input.name))
			throw error('CHART_EXISTS', 'Choose a different chart name. Existing charts are preserved.');
		const position = range.getPropertyValue('Position'),
			size = range.getPropertyValue('Size');
		const undo = model.getUndoManager();
		undo.enterUndoContext('Insert column chart');
		try {
			charts.addNewByName(
				input.name,
				new css.awt.Rectangle({
					X: position.X + size.Width + 500,
					Y: position.Y,
					Width: 13000,
					Height: 7500,
				}),
				[range.getRangeAddress()],
				true,
				true,
			);
			const document = charts.getByName(input.name).getEmbeddedObject();
			const diagram = document.createInstance('com.sun.star.chart.BarDiagram');
			document.setDiagram(diagram);
			// UNO's legacy BarDiagram flag is counterintuitive: false is columns.
			diagram.setPropertyValue('Vertical', false);
			diagram.setPropertyValue('Dim3D', false);
			document.setPropertyValue('HasMainTitle', true);
			document.getTitle().setPropertyValue('String', input.title || input.name);
		} catch (e) {
			if (charts.hasByName(input.name)) charts.removeByName(input.name);
			throw e;
		} finally {
			undo.leaveUndoContext();
		}
		model.getCurrentController().setActiveSheet(target);
		return { name: input.name, sheet: target.getName(), range: input.range };
	}
	function exportChart(model, input) {
		const target = sheet(model, input.sheet),
			charts = target.getCharts();
		if (!charts.hasByName(input.name))
			throw error('CHART_MISSING', 'Read the workbook for available chart names.');
		// The chart's drawing shape is the exportable XComponent. PersistentName
		// identifies the same embedded object as XTableCharts, not its display title.
		const page = target.getDrawPage();
		let shape;
		for (let i = 0; i < page.getCount(); i++) {
			const candidate = page.getByIndex(i);
			try {
				if (candidate.getPropertyValue('PersistName') === input.name) {
					shape = candidate;
					break;
				}
			} catch {}
		}
		if (!shape)
			throw error(
				'CHART_MISSING',
				'The chart drawing is unavailable. Save and reopen the workbook.',
			);
		const exporter = context
			.getServiceManager()
			.createInstanceWithContext('com.sun.star.drawing.GraphicExportFilter', context);
		exporter.setSourceDocument(shape);
		const file = '/tmp/chart.png';
		if (!exporter.filter([property('MediaType', 'image/png'), property('URL', `file://${file}`)]))
			throw error('EXPORT_FAILED', 'The chart could not be exported.');
		return { file };
	}
	return { create, read, edit, chart, exportChart };
};
