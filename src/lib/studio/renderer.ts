import { selectStudioRows } from './view';
import type { StudioFile, StudioRow, StudioSource } from './studio';

// Only this renderer executes. Workspace values are serialized as data and reach
// textContent, never HTML, styles, event handlers, URLs, or executable code.
const script = String.raw`
rows = rows.map((row) => Object.assign(Object.create(null), row));
const byId = (id) => document.getElementById(id);
const text = (value) => value === null || value === undefined ? '' : String(value);
const element = (tag, value, className) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = text(value);
  if (className) node.className = className;
  return node;
};
byId('title').textContent = app.title;
byId('description').textContent = app.description;
const search = byId('search');
const filter = byId('filter');
const view = byId('view');
view.value = app.view;
let requestId = null;
if (app.filterField) {
  const label = app.columns.find((column) => column.key === app.filterField);
  byId('filter-label').textContent = label.label;
  filter.setAttribute('aria-label', label.label);
  [...new Set(rows.map((row) => text(row[app.filterField])))].sort().forEach((value) => {
    const option = element('option', value || '(Empty)');
    option.value = value;
    filter.append(option);
  });
} else byId('filter-control').hidden = true;
function sourceButton(row) {
  if (!app.sourceField || !row[app.sourceField]) return null;
  const path = text(row[app.sourceField]);
  const source = sources.find((item) => item.path === path);
  const button = element('button', source?.exists ? 'Open source' : source ? 'Source missing' : 'Source not selected', 'source');
  button.type = 'button';
  button.disabled = !source?.exists;
  if (source?.exists) button.addEventListener('click', () => {
    parent.postMessage({ type: 'studio:open-source', token, path }, parentOrigin);
  });
  return button;
}
function render() {
  const state={query:search.value,filter:filter.selectedIndex===0?null:filter.value,view:view.value};
  const selected = selectStudioRows(rows,app,state);
  parent.postMessage({type:'studio:view',token,state,requestId},parentOrigin);
  requestId=null;
  byId('count').textContent = selected.length + ' of ' + rows.length + ' records';
  const results = byId('results');
  results.replaceChildren();
  results.className = view.value;
  if (!selected.length) {
    results.append(element('p', rows.length ? 'No records match. Try another search or filter.' : 'This data file has no records yet.', 'empty'));
    return;
  }
  if (view.value === 'table') {
    const table = element('table');
    const head = element('thead');
    const headers = element('tr');
    app.columns.forEach((column) => {
      const cell = element('th', column.label); cell.scope = 'col'; headers.append(cell);
    });
    if (app.sourceField) headers.append(element('th', 'Source'));
    head.append(headers); table.append(head);
    const body = element('tbody');
    selected.forEach((row) => {
      const line = element('tr');
      app.columns.forEach((column) => line.append(element('td', row[column.key])));
      if (app.sourceField) { const cell = element('td'); const button = sourceButton(row); if (button) cell.append(button); line.append(cell); }
      body.append(line);
    });
    table.append(body); results.append(table);
  } else {
    selected.forEach((row) => {
      const article = element('article');
      article.append(element('h2', text(row[app.titleField]) || 'Untitled record'));
      const details = element('dl');
      app.columns.filter((column) => column.key !== app.titleField).forEach((column) => {
        const pair = element('div'); pair.append(element('dt', column.label), element('dd', row[column.key])); details.append(pair);
      });
      article.append(details);
      const button = sourceButton(row); if (button) article.append(button);
      results.append(article);
    });
  }
}
window.addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==parentOrigin||event.data?.type!=='studio:set-view'||event.data.token!==token)return;
 const state=event.data.state;
 if(!state||typeof state.query!=='string'||state.query.length>1000||!['cards','table'].includes(state.view)||(state.filter!==null&&typeof state.filter!=='string'))return;
 search.value=state.query;view.value=state.view;
 filter.selectedIndex=state.filter===null?0:[...filter.options].findIndex((option,index)=>index>0&&option.value===state.filter);
 requestId=event.data.requestId;
 render();
});
search.addEventListener('input', render);
filter.addEventListener('change', render);
view.addEventListener('change', render);
render();
`;

const style = `
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:#f6f7fa;color:#202934;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{padding:24px 28px 16px;border-bottom:1px solid #e3e6ec;background:#fff}h1{font-size:24px;letter-spacing:-.6px;margin:0 0 5px}header p{margin:0;color:#687282;max-width:700px;white-space:pre-wrap;overflow-wrap:anywhere}
.controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap;padding:16px 28px 8px}.controls label{display:grid;gap:5px;font-size:11px;font-weight:600;color:#596576}.search-control{flex:1;min-width:130px}
input,select{font:inherit;font-size:13px;border:1px solid #cbd2dc;border-radius:7px;background:white;padding:8px 10px;color:#243044}input:focus,select:focus,button:focus-visible{outline:2px solid #3975db;outline-offset:2px}
#count{margin:0;padding:5px 28px 13px;color:#6a7584;font-size:12px}#results{padding:0 28px 24px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,265px),1fr));gap:13px}article{background:#fff;border:1px solid #dfe4eb;border-radius:10px;padding:18px;min-width:0}h2{font-size:15px;line-height:1.4;margin:0 0 15px;overflow-wrap:anywhere}dl{margin:0}dl div{margin-bottom:12px}dt{font-size:10px;letter-spacing:.4px;text-transform:uppercase;color:#7b8390;margin-bottom:3px}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}button{font:inherit;font-size:12px;border:1px solid #cbd5e3;background:#f5f8fd;color:#245999;padding:6px 10px;border-radius:6px;cursor:pointer}button:disabled{color:#7c8390;cursor:default;background:#f3f4f6}
.table{overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dfe4eb}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #e3e6ec;max-width:330px;min-width:110px;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#eef1f6;font-size:11px;color:#596576}td{font-size:12px}.empty{grid-column:1/-1;padding:36px 0;color:#6a7584}[hidden]{display:none!important}
@media(max-width:520px){header{padding:18px 16px 12px}.controls{padding:12px 16px 6px}#count{padding:5px 16px 12px}#results{padding:0 16px 20px}h1{font-size:21px}.controls label{min-width:100px}.search-control{flex-basis:100%}}
`;
const json = (value: unknown) =>
	JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');

export function renderExplorer(
	app: StudioFile,
	rows: StudioRow[],
	sources: StudioSource[],
	token: string,
) {
	const nonce = crypto.randomUUID().replaceAll('-', '');
	const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace app</title><style nonce="${nonce}">${style}</style></head><body><header><h1 id="title"></h1><p id="description"></p></header><div class="controls"><label class="search-control">Search records<input id="search" type="search" autocomplete="off" placeholder="Search selected fields"></label><label id="filter-control"><span id="filter-label">Filter</span><select id="filter"><option value="">All</option></select></label><label>View<select id="view" aria-label="View"><option value="cards">Cards</option><option value="table">Table</option></select></label></div><p id="count" role="status" aria-live="polite"></p><main id="results"></main><script nonce="${nonce}">const app=${json(app)};let rows=${json(rows)};const sources=${json(sources)},token=${json(token)},parentOrigin=${json(location.origin)};const selectStudioRows=${selectStudioRows.toString()};${script}</script></body></html>`;
}

export function studioSourceRequest(
	data: unknown,
	token: string,
	sources: StudioSource[],
): string | null {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
	const input = data as Record<string, unknown>;
	if (
		Object.keys(input).length !== 3 ||
		input.type !== 'studio:open-source' ||
		input.token !== token ||
		typeof input.path !== 'string'
	)
		return null;
	return sources.some((source) => source.path === input.path && source.exists) ? input.path : null;
}
