// UNO integration based on allotropia/zetajs examples (MIT). See NOTICE.md.
'use strict';
Module.zetajs.then((zeta) => {
	const css = zeta.uno.com.sun.star;
	const context = zeta.getUnoComponentContext();
	// Use the pinned runtime's small icon preferences for both Writer and Calc.
	// Common/Misc uses 0 for 16px toolbar icons and 1 for small sidebar icons.
	const config = css.configuration.ReadWriteAccess.create(context, 'en-US');
	const appearance = config.getByHierarchicalName('/org.openoffice.Office.Common/Misc');
	appearance.setPropertyValue('SymbolSet', new zeta.Any(zeta.type.short, 0));
	appearance.setPropertyValue('SidebarIconSize', new zeta.Any(zeta.type.short, 1));
	config.commitChanges();
	const desktop = css.frame.Desktop.create(context);
	const port = zeta.mainPort;
	let model,
		revision = Date.now(),
		bindings = [];
	const property = (Name, Value) => new css.beans.PropertyValue({ Name, Value });
	const error = (code, message) => Object.assign(new Error(message), { code });
	const sheets = Module.desktopSheets(zeta, context, property, error);
	let sheetMode = false;
	const formats = { odt: 'writer8', docx: 'Office Open XML Text', pdf: 'writer_pdf_Export' };
	// This browser build has no printer integration. PDF export is the supported
	// route; PrintLayout is intentionally retained as Writer's editing view.
	const disabledCommands = new Set([
		'.uno:Print',
		'.uno:PrintDefault',
		'.uno:PrinterSetup',
		'.uno:PrintPreview',
		'.uno:PrintPagePreview',
		'.uno:MailMergePrintDocuments',
	]);
	const nativeActions = {
		'.uno:Save': 'save',
		'.uno:SaveAs': 'save-as',
		'.uno:SaveAsTemplate': 'save-as',
		'.uno:SaveACopy': 'save-as',
		'.uno:SaveAsRemote': 'save-as',
		'.uno:SaveAll': 'save',
		'.uno:Open': 'open',
		'.uno:OpenFromWriter': 'open',
		'.uno:OpenRemote': 'open',
		'.uno:NewDoc': 'new',
		'private:factory/swriter': 'new',
		'private:factory/scalc': 'new',
		'.uno:ExportTo': 'export',
		'.uno:ExportToPDF': 'export',
		'.uno:ExportDirectToPDF': 'export',
		'.uno:InsertGraphic': 'insert-image',
		'.uno:CloseDoc': 'close',
		'.uno:CloseWin': 'close',
		'.uno:Quit': 'close',
	};
	function connect(next, app) {
		if (!next) throw error('OPEN_FAILED', 'Office could not open this file.');
		const isSheet = app === 'sheets';
		if (
			!next.supportsService(
				isSheet ? 'com.sun.star.sheet.SpreadsheetDocument' : 'com.sun.star.text.TextDocument',
			)
		) {
			next.close(true);
			throw error(
				'UNSUPPORTED_FORMAT',
				isSheet
					? 'Sheets supports ODS and XLSX workbooks.'
					: 'Documents supports Writer documents: DOCX, ODT, DOC, and RTF.',
			);
		}
		if (model) {
			model.setModified(false);
			model.close(true);
		}
		model = next;
		sheetMode = isSheet;
		revision++;
		const frame = model.getCurrentController().getFrame();
		frame.getContainerWindow().FullScreen = true;
		if (!sheetMode)
			model
				.getCurrentController()
				.getViewSettings()
				.setPropertyValue(
					'ZoomType',
					new zeta.Any(zeta.type.short, css.view.DocumentZoomType.PAGE_WIDTH),
				);
		const modify = zeta.unoObject([css.util.XModifyListener], {
			modified() {
				if (!model.isModified()) return;
				revision++;
				port.postMessage({ type: 'changed', revision });
			},
			disposing() {},
		});
		model.addModifyListener(modify);
		// Keep the real menus/toolbars, routing filesystem actions to our workspace.
		let slave = null,
			master = null;
		const dispatch = zeta.unoObject([css.frame.XDispatch], {
			dispatch(url) {
				port.postMessage({ type: 'action', action: nativeActions[url.Complete] });
			},
			addStatusListener(listener, url) {
				listener.statusChanged(
					new css.frame.FeatureStateEvent({ FeatureURL: url, IsEnabled: true, Requery: false }),
				);
			},
			removeStatusListener() {},
		});
		const disabledDispatch = zeta.unoObject([css.frame.XDispatch], {
			dispatch() {},
			addStatusListener(listener, url) {
				listener.statusChanged(
					new css.frame.FeatureStateEvent({ FeatureURL: url, IsEnabled: false, Requery: false }),
				);
			},
			removeStatusListener() {},
		});
		const queryDispatch = (url, target, flags) =>
			disabledCommands.has(url.Complete) || (sheetMode && url.Complete === '.uno:InsertGraphic')
				? disabledDispatch
				: nativeActions[url.Complete]
					? dispatch
					: (slave?.queryDispatch(url, target, flags) ?? null);
		const interceptor = zeta.unoObject(
			[css.frame.XDispatchProviderInterceptor, css.frame.XInterceptorInfo],
			{
				getInterceptedURLs() {
					return [...Object.keys(nativeActions), ...disabledCommands];
				},
				getSlaveDispatchProvider() {
					return slave;
				},
				setSlaveDispatchProvider(value) {
					slave = value;
				},
				getMasterDispatchProvider() {
					return master;
				},
				setMasterDispatchProvider(value) {
					master = value;
				},
				queryDispatch,
				queryDispatches(requests) {
					return requests.map((request) =>
						queryDispatch(request.FeatureURL, request.FrameName, request.SearchFlags),
					);
				},
			},
		);
		frame.registerDispatchProviderInterceptor(interceptor);
		bindings = [modify, interceptor, dispatch, disabledDispatch]; // UNO proxies must stay alive.
	}
	function paragraphs() {
		const results = [];
		for (const element of model.getText().createEnumeration()) {
			if (element.supportsService('com.sun.star.text.Paragraph')) results.push(element);
		}
		return results;
	}
	function setStyle(range, style) {
		if (!model.getStyleFamilies().getByName('ParagraphStyles').hasByName(style)) {
			throw error(
				'UNKNOWN_STYLE',
				`Paragraph style ${style} is not available. Read the document styles first.`,
			);
		}
		range.setPropertyValue('ParaStyleName', style);
	}
	function validateStyles(document, blocks) {
		const styles = document.getStyleFamilies().getByName('ParagraphStyles');
		for (const block of blocks)
			if (block.type === 'paragraph' && block.style && !styles.hasByName(block.style)) {
				throw error(
					'UNKNOWN_STYLE',
					`Paragraph style ${block.style} is not available. Read the document styles first.`,
				);
			}
	}
	function append(blocks) {
		validateStyles(model, blocks);
		const text = model.getText();
		const cursor = text.createTextCursor();
		cursor.gotoEnd(false);
		if (text.getString())
			text.insertControlCharacter(cursor, css.text.ControlCharacter.PARAGRAPH_BREAK, false);
		blocks.forEach((block, index) => {
			cursor.gotoEnd(false);
			if (block.type === 'table') {
				const table = model.createInstance('com.sun.star.text.TextTable');
				table.initialize(block.rows.length, block.rows[0].length);
				text.insertTextContent(cursor, table, false);
				block.rows.forEach((row, r) =>
					row.forEach((value, c) =>
						table.getCellByName(`${String.fromCharCode(65 + c)}${r + 1}`).setString(value),
					),
				);
			} else {
				setStyle(cursor, block.style || 'Standard');
				text.insertString(cursor, block.text, false);
			}
			cursor.gotoEnd(false);
			if (index < blocks.length - 1)
				text.insertControlCharacter(cursor, css.text.ControlCharacter.PARAGRAPH_BREAK, false);
		});
	}

	function paragraphRuns(paragraph, offset) {
		const runs = [];
		let position = 0,
			nextRunTextOffset = null;
		for (const portion of paragraph.createEnumeration()) {
			const length = portion.getString().length,
				start = position;
			position += length;
			if (position <= offset) continue;
			if (runs.length === 200) {
				nextRunTextOffset = start;
				break;
			}
			const get = (name) => portion.getPropertyValue(name);
			runs.push({
				start,
				end: position,
				type: get('TextPortionType'),
				bold: get('CharWeight') >= css.awt.FontWeight.BOLD,
				italic: get('CharPosture') === css.awt.FontSlant.ITALIC,
				underline: get('CharUnderline') !== css.awt.FontUnderline.NONE,
				fontSize: get('CharHeight'),
				fontName: get('CharFontName'),
				color: get('CharColor'),
				link: get('HyperLinkURL'),
			});
		}
		return { runs, nextRunTextOffset };
	}
	function read(input) {
		if (input.expectedRevision !== undefined && input.expectedRevision !== revision)
			throw error(
				'DOCUMENT_CHANGED',
				'The document changed. Restart the read with its current revision.',
			);
		const text = model.getText().getString();
		let selection = null;
		try {
			// Writer has no text cursor while an image/drawing object is selected,
			// including immediately after redoing an image insertion.
			const cursor = model.getCurrentController().getViewCursor();
			const selectedText = cursor.getString();
			selection = {
				collapsed: cursor.isCollapsed(),
				text: selectedText.slice(0, 10_000),
				truncated: selectedText.length > 10_000,
			};
		} catch {}
		const all = paragraphs();
		const tables = model.getTextTables();
		const names = tables.getElementNames();
		const graphics = model.getGraphicObjects();
		const imageNames = graphics.getElementNames();
		const totals = {
			characters: text.length,
			paragraphs: all.length,
			tables: names.length,
			images: imageNames.length,
		};
		const scope = input.scope || 'overview';
		if (scope !== 'overview') {
			const offset = input.offset || 0,
				limit = input.limit || 50,
				textOffset = input.textOffset || 0;
			let budget = input.maxChars || 100000;
			const clip = (value) => {
				const result = value.slice(textOffset, textOffset + budget);
				budget -= result.length;
				return {
					text: result,
					truncated: textOffset + result.length < value.length,
					totalCharacters: value.length,
					nextTextOffset:
						textOffset + result.length < value.length ? textOffset + result.length : null,
				};
			};
			const result = {
				revision,
				totals,
				selection,
				text: '',
				truncated: false,
				imageCount: imageNames.length,
				images: [],
				paragraphs: [],
				tables: [],
				styles: [],
			};
			let total, count;
			if (scope === 'text') {
				result.text = text.slice(offset, offset + budget);
				total = text.length;
				count = result.text.length;
			} else if (scope === 'paragraphs') {
				total = all.length;
				for (let index = offset; index < Math.min(total, offset + limit) && budget > 0; index++) {
					const paragraph = all[index];
					result.paragraphs.push({
						index,
						style: paragraph.getPropertyValue('ParaStyleName'),
						...clip(paragraph.getString()),
						...(input.includeFormatting ? paragraphRuns(paragraph, textOffset) : {}),
					});
				}
				count = result.paragraphs.length;
			} else if (scope === 'tables') {
				total = names.length;
				result.tables = names.slice(offset, offset + limit).map((name) => ({
					name,
					cellCount: tables.getByName(name).getCellNames().length,
					cells: [],
					truncated: false,
				}));
				count = result.tables.length;
			} else if (scope === 'table') {
				if (!tables.hasByName(input.table))
					throw error('TABLE_MISSING', 'Read scope tables for valid names.');
				const table = tables.getByName(input.table),
					cells = table.getCellNames();
				total = cells.length;
				const rows = [];
				for (let i = offset; i < Math.min(total, offset + limit) && budget > 0; i++)
					rows.push({ cell: cells[i], ...clip(table.getCellByName(cells[i]).getString()) });
				count = rows.length;
				result.tables = [
					{ name: input.table, cells: rows, truncated: rows.some((row) => row.truncated) },
				];
			} else {
				total = imageNames.length;
				result.images = imageNames.slice(offset, offset + limit).map((name) => {
					const image = graphics.getByName(name),
						description = clip(image.getPropertyValue('Description'));
					return {
						name,
						description: description.text,
						truncated: description.truncated,
						nextTextOffset: description.nextTextOffset,
						widthMm: image.getPropertyValue('Width') / 100,
						heightMm: image.getPropertyValue('Height') / 100,
					};
				});
				count = result.images.length;
			}
			result.page = {
				scope,
				offset,
				nextOffset: offset + count < total ? offset + count : null,
				total,
				textOffset,
			};
			result.truncated =
				result.page.nextOffset !== null ||
				result.paragraphs.some((p) => p.truncated) ||
				result.tables.some((t) => t.truncated) ||
				result.images.some((i) => i.truncated);
			return result;
		}
		let remaining = 100_000;
		let structuredTruncated = false;
		function boundedText(value, limit) {
			const text = value.slice(0, Math.min(limit, remaining));
			remaining -= text.length;
			const truncated = text.length < value.length;
			structuredTruncated ||= truncated;
			return { text, truncated };
		}
		const paragraphResults = all.slice(0, 500).map((paragraph, index) => ({
			index,
			...boundedText(paragraph.getString(), 10_000),
			style: paragraph.getPropertyValue('ParaStyleName'),
		}));
		const tableResults = names.slice(0, 20).map((name) => {
			const table = tables.getByName(name);
			const names = table.getCellNames();
			const cells = names.slice(0, 400).map((cell) => ({
				cell,
				...boundedText(table.getCellByName(cell).getString(), 5000),
			}));
			return { name, truncated: names.length > 400 || cells.some((cell) => cell.truncated), cells };
		});
		const imageResults = imageNames.slice(0, 50).map((name) => {
			const graphic = graphics.getByName(name);
			const description = boundedText(graphic.getPropertyValue('Description'), 2000);
			return {
				name,
				description: description.text,
				truncated: description.truncated,
				widthMm: graphic.getPropertyValue('Width') / 100,
				heightMm: graphic.getPropertyValue('Height') / 100,
			};
		});
		return {
			revision,
			totals,
			selection,
			text: text.slice(0, 100_000),
			truncated:
				text.length > 100_000 ||
				all.length > 500 ||
				names.length > 20 ||
				imageNames.length > 50 ||
				structuredTruncated ||
				tableResults.some((table) => table.truncated),
			imageCount: imageNames.length,
			images: imageResults,
			paragraphs: paragraphResults,
			styles: model.getStyleFamilies().getByName('ParagraphStyles').getElementNames(),
			tables: tableResults,
		};
	}

	function extendEdit(op) {
		const types = [
			'text-range',
			'insert-paragraph',
			'move-paragraph',
			'table-structure',
			'image',
			'page-layout',
		];
		if (!types.includes(op.type)) return false;
		const undo = model.getUndoManager();
		// Validate model addresses before entering the undo group.
		let paragraph, cursor, object, collection;
		if (['text-range', 'insert-paragraph', 'move-paragraph'].includes(op.type)) {
			const all = paragraphs();
			paragraph = all[op.index];
			if (!paragraph) throw error('PARAGRAPH_MISSING', 'Read paragraphs for a valid index.');
			if (
				op.type === 'move-paragraph' &&
				(op.index + op.delta < 0 || op.index + op.delta >= all.length)
			)
				throw error('INVALID_INPUT', 'Paragraph destination is outside the document.');
			if (op.type === 'text-range' && op.end > paragraph.getString().length)
				throw error('INVALID_INPUT', 'Text range exceeds the paragraph length.');
			if (op.style !== undefined) validateStyles(model, [{ type: 'paragraph', style: op.style }]);
			cursor = paragraph.getText().createTextCursorByRange(paragraph.getStart());
		}
		if (op.type === 'table-structure') {
			if (!model.getTextTables().hasByName(op.table))
				throw error('TABLE_MISSING', 'Read tables for a valid name.');
			object = model.getTextTables().getByName(op.table);
			collection = op.axis === 'rows' ? object.getRows() : object.getColumns();
			const count = collection.getCount();
			if (
				op.index > count ||
				(op.action === 'remove' && (op.index + op.count > count || op.count >= count))
			)
				throw error('INVALID_INPUT', 'Choose existing rows/columns and leave at least one.');
		}
		if (op.type === 'image') {
			if (!model.getGraphicObjects().hasByName(op.name))
				throw error('IMAGE_MISSING', 'Read images for a valid name.');
			object = model.getGraphicObjects().getByName(op.name);
		}
		if (op.type === 'page-layout') {
			const pageName = model
				.getCurrentController()
				.getViewCursor()
				.getPropertyValue('PageStyleName');
			object = model.getStyleFamilies().getByName('PageStyles').getByName(pageName);
		}
		undo.enterUndoContext('Edit document ' + op.type);
		let failed;
		try {
			if (op.type === 'text-range') {
				const advance = (n, expand) => {
					while (n > 0) {
						const count = Math.min(n, 32767);
						cursor.goRight(count, expand);
						n -= count;
					}
				};
				advance(op.start, false);
				advance(op.end - op.start, true);
				if (op.text !== undefined) cursor.setString(op.text);
				if (op.bold !== undefined)
					cursor.setPropertyValue(
						'CharWeight',
						new zeta.Any(
							zeta.type.float,
							op.bold ? css.awt.FontWeight.BOLD : css.awt.FontWeight.NORMAL,
						),
					);
				if (op.italic !== undefined)
					cursor.setPropertyValue(
						'CharPosture',
						op.italic ? css.awt.FontSlant.ITALIC : css.awt.FontSlant.NONE,
					);
				if (op.underline !== undefined)
					cursor.setPropertyValue(
						'CharUnderline',
						new zeta.Any(
							zeta.type.short,
							op.underline ? css.awt.FontUnderline.SINGLE : css.awt.FontUnderline.NONE,
						),
					);
				if (op.fontSize !== undefined)
					cursor.setPropertyValue('CharHeight', new zeta.Any(zeta.type.float, op.fontSize));
				if (op.fontName !== undefined) cursor.setPropertyValue('CharFontName', op.fontName);
				if (op.color !== undefined)
					cursor.setPropertyValue('CharColor', parseInt(op.color.slice(1), 16));
				if (op.link !== undefined) cursor.setPropertyValue('HyperLinkURL', op.link);
			} else if (op.type === 'insert-paragraph') {
				cursor.getText().insertString(cursor, op.text, false);
				cursor.collapseToEnd();
				cursor
					.getText()
					.insertControlCharacter(cursor, css.text.ControlCharacter.PARAGRAPH_BREAK, false);
				if (op.style !== undefined) setStyle(paragraphs()[op.index], op.style);
			} else if (op.type === 'move-paragraph') {
				if (op.delta !== 0) {
					const all = paragraphs(),
						destination = all[op.index + op.delta],
						text = paragraph.getText();
					const touchesEnd = op.index === all.length - 1 || op.index + op.delta === all.length - 1;
					if (touchesEnd) {
						const end = text.createTextCursor();
						end.gotoEnd(false);
						text.insertControlCharacter(end, css.text.ControlCharacter.PARAGRAPH_BREAK, false);
					}
					const target = text.createTextCursorByRange(
						op.delta > 0 ? destination.getEnd() : destination.getStart(),
					);
					if (op.delta > 0) target.goRight(1, false);
					cursor.gotoRange(paragraph.getEnd(), true);
					cursor.goRight(1, true);
					const controller = model.getCurrentController();
					controller.select(cursor);
					const content = controller.getTransferable();
					cursor.setString('');
					controller.select(target);
					controller.insertTransferable(content);
					if (touchesEnd) {
						const end = text.createTextCursor();
						end.gotoEnd(false);
						end.goLeft(1, true);
						end.setString('');
					}
				}
			} else if (op.type === 'table-structure') {
				if (op.action === 'insert') collection.insertByIndex(op.index, op.count);
				else collection.removeByIndex(op.index, op.count);
			} else if (op.type === 'image') {
				if (op.action === 'remove') object.getAnchor().getText().removeTextContent(object);
				else {
					object.setPropertyValue('Width', Math.round(op.widthMm * 100));
					object.setPropertyValue('Height', Math.round(op.heightMm * 100));
				}
			} else {
				object.setPropertyValue('IsLandscape', op.widthMm > op.heightMm);
				object.setPropertyValue('Width', Math.round(op.widthMm * 100));
				object.setPropertyValue('Height', Math.round(op.heightMm * 100));
				for (const side of ['Left', 'Right', 'Top', 'Bottom'])
					object.setPropertyValue(side + 'Margin', Math.round(op.marginMm * 100));
			}
		} catch (e) {
			failed = e;
		} finally {
			undo.leaveUndoContext();
		}
		if (failed) {
			if (undo.isUndoPossible() && undo.getCurrentUndoActionTitle() === 'Edit document ' + op.type)
				undo.undo();
			throw failed;
		}
		return true;
	}
	function execute(input) {
		if (input.cmd === 'open' || input.cmd === 'create') {
			const url =
				input.cmd === 'open'
					? `file://${input.file}`
					: input.app === 'sheets'
						? 'private:factory/scalc'
						: 'private:factory/swriter';
			const next = desktop.loadComponentFromURL(url, '_blank', 0, [
				property('MacroExecutionMode', css.document.MacroExecMode.NEVER_EXECUTE),
				property('UpdateDocMode', css.document.UpdateDocMode.NO_UPDATE),
			]);
			if (input.cmd === 'create' && input.app !== 'sheets') {
				try {
					validateStyles(next, input.blocks || []);
				} catch (e) {
					next.close(true);
					throw e;
				}
			}
			connect(next, input.app);
			if (sheetMode) {
				if (input.cmd === 'create')
					sheets.create(model, input.sheets || [{ name: 'Sheet1', values: [['']] }]);
			} else {
				if (input.cmd === 'create' && input.blocks?.length) append(input.blocks);
				model.getCurrentController().getViewCursor().gotoStart(false);
			}
			// A new Writer frame can initially focus the paragraph-style combo.
			// Put typing in the document before reporting that the file is open.
			model.getCurrentController().getFrame().getComponentWindow().setFocus();
			return { revision };
		}
		if (!model) throw error('NO_DOCUMENT', 'Open or create a document first.');
		if (input.cmd.startsWith('sheet-')) {
			if (!sheetMode) throw error('UNSUPPORTED_FORMAT', 'Open a workbook in Sheets.');
			if (input.cmd === 'sheet-read') return { ...sheets.read(model, input), revision };
			if (input.cmd === 'sheet-export-chart') return sheets.exportChart(model, input);
			if (input.expectedRevision !== revision)
				throw error(
					'DOCUMENT_CHANGED',
					'The workbook changed. Read it again and use its current revision.',
				);
			if (input.cmd === 'sheet-select') return { selection: sheets.select(model, input), revision };
			if (input.cmd === 'sheet-edit') sheets.edit(model, input.operation);
			else if (input.cmd === 'sheet-chart') {
				const chart = sheets.chart(model, input.chart);
				return { chart, revision };
			} else throw error('INVALID_INPUT', 'Unknown workbook operation.');
			return { revision };
		}
		if (input.cmd === 'read') return read(input);
		if (input.cmd === 'select') {
			if (input.expectedRevision !== revision)
				throw error('DOCUMENT_CHANGED', 'Read the current document before selecting text.');
			const paragraph = paragraphs()[input.index];
			if (!paragraph || input.end > paragraph.getString().length)
				throw error(
					'INVALID_INPUT',
					'Select an existing paragraph and text offsets from documents_read.',
				);
			const cursor = paragraph.getText().createTextCursorByRange(paragraph.getStart());
			const advance = (n, expand) => {
				while (n > 0) {
					const count = Math.min(n, 32767);
					cursor.goRight(count, expand);
					n -= count;
				}
			};
			advance(input.start, false);
			advance(input.end - input.start, true);
			model.getCurrentController().select(cursor);
			return {
				revision,
				selection: {
					text: cursor.getString().slice(0, 10000),
					truncated: cursor.getString().length > 10000,
					collapsed: cursor.isCollapsed(),
				},
			};
		}
		if (input.cmd === 'state') return { revision, modified: model.isModified() };
		if (input.cmd === 'mark-saved') {
			if (input.revision === revision) model.setModified(false);
			return { revision };
		}
		if (input.cmd === 'serialize') {
			const filter = sheetMode
				? { ods: 'calc8', xlsx: 'Calc MS Excel 2007 XML', pdf: 'calc_pdf_Export' }[input.format]
				: formats[input.format];
			if (!filter) throw error('UNSUPPORTED_FORMAT', 'Export as ODT, DOCX, or PDF.');
			const file = `/tmp/export.${input.format}`;
			model.storeToURL(`file://${file}`, [
				property('Overwrite', true),
				property('FilterName', filter),
			]);
			return { file, revision };
		}
		if (input.cmd === 'edit') {
			if (input.expectedRevision !== revision)
				throw error(
					'DOCUMENT_CHANGED',
					'The document changed. Read it again and use its current revision.',
				);
			const op = input.operation;
			if (extendEdit(op)) return { revision };
			if (op.type === 'replace') {
				const descriptor = model.createReplaceDescriptor();
				descriptor.setSearchString(op.find);
				descriptor.setReplaceString(op.replace);
				descriptor.setPropertyValue('SearchRegularExpression', false);
				descriptor.setPropertyValue('SearchCaseSensitive', true);
				const count = model.findAll(descriptor).getCount();
				if (count !== op.expectedOccurrences)
					throw error(
						'MATCH_COUNT',
						`Found ${count} matches; expected ${op.expectedOccurrences}. Read the document and specify the intended passage.`,
					);
				model.replaceAll(descriptor);
			} else if (op.type === 'paragraph') {
				const paragraph = paragraphs()[op.index];
				if (!paragraph)
					throw error('PARAGRAPH_MISSING', 'Read the document for valid paragraph indices.');
				if (op.style !== undefined) setStyle(paragraph, op.style);
				if (op.text !== undefined) paragraph.setString(op.text);
			} else if (op.type === 'table-cell') {
				const tables = model.getTextTables();
				if (!tables.hasByName(op.table))
					throw error('TABLE_MISSING', 'Read the document for valid table names.');
				tables.getByName(op.table).getCellByName(op.cell).setString(op.text);
			} else if (op.type === 'insert-image') {
				let cursor;
				if (op.position === 'end') {
					cursor = model.getText().createTextCursor();
					cursor.gotoEnd(false);
				} else {
					const controller = model.getCurrentController();
					try {
						cursor = controller.getViewCursor();
						cursor.collapseToEnd();
					} catch {
						// Redo and clicking an image select the object instead of text.
						// Insert beside its anchor without replacing the selected image.
						const selected = controller.getSelection();
						if (typeof selected?.getAnchor !== 'function')
							throw error(
								'NO_TEXT_CURSOR',
								'Click in the document text, then choose Insert Image again.',
							);
						const anchor = selected.getAnchor();
						cursor = anchor.getText().createTextCursorByRange(anchor.getEnd());
					}
				}
				const provider = context
					.getServiceManager()
					.createInstanceWithContext('com.sun.star.graphic.GraphicProvider', context);
				const graphic = provider.queryGraphic([
					property('URL', `file://${input.image.file}`),
					property('LoadAsLink', false),
				]);
				if (!graphic) throw error('INVALID_IMAGE', 'Office could not load this image.');
				const undo = model.getUndoManager();
				undo.enterUndoContext('Insert image');
				try {
					const image = model.createInstance('com.sun.star.text.TextGraphicObject');
					image.setPropertyValue(
						'Graphic',
						new zeta.Any(zeta.type.interface(css.graphic.XGraphic), graphic),
					);
					image.setPropertyValue('AnchorType', css.text.TextContentAnchorType.AS_CHARACTER);
					image.setPropertyValue('Width', input.image.width);
					image.setPropertyValue('Height', input.image.height);
					image.setPropertyValue('Description', op.description);
					cursor.getText().insertTextContent(cursor, image, false);
				} finally {
					undo.leaveUndoContext();
				}
			} else if (op.type === 'append') append(op.blocks);
			else throw error('INVALID_INPUT', 'Unknown document operation.');
			return { revision };
		}
		throw error('INVALID_INPUT', 'Unknown office operation.');
	}
	port.onmessage = ({ data: input }) => {
		try {
			port.postMessage({ id: input.id, result: execute(input) });
		} catch (e) {
			let message = e?.message;
			if (!message) {
				try {
					message = zeta.catchUnoException(e).Message;
				} catch {}
			}
			port.postMessage({
				id: input.id,
				error: { code: e?.code || 'OFFICE_ERROR', message: message || String(e) },
			});
		}
	};
	port.postMessage({ type: 'ready' });
});
