// The host-provided part is the same PageListTable used by Colab, admitted by runtime 3.
export default ({ React, html, parts }) => {
  const Table = parts.PageListTable;
  return function PageView(props) {
    const [groupBy, setGroupBy] = React.useState(props['group-by'] || 'state');
    const [collapsed, setCollapsed] = React.useState(new Set());
    const [selected, setSelected] = React.useState(new Set(props.selected ? [props.selected] : []));
    const columns = [['title', 'Page'], ['project', 'Project'], ['stage', 'Stage'],
      ['updated', 'Updated'], ['author', 'Owner'], ['access', 'Access']];
    const [visible, setVisible] = React.useState(columns.map(([id]) => id));
    let raw;
    try { raw = JSON.parse(props.rows || '[]'); } catch { raw = []; }
    const rows = (Array.isArray(raw) ? raw : []).slice(0, 200).filter((item) =>
      item && typeof item.id === 'string' && typeof item.name === 'string').map((item) => ({
        id: item.id, name: item.name, title: item.name,
        projects: Array.isArray(item.projects) ? item.projects.filter((v) => typeof v === 'string') : [],
        stage: typeof item.stage === 'string' ? { id: item.stage, label: item.stage } : undefined,
        updated: typeof item.updated === 'string' ? item.updated : '',
        author: typeof item.author === 'string' ? item.author : '',
        access: typeof item.access === 'string' ? item.access : 'Team',
      }));
    const group = (row) => groupBy === 'state' ? row.stage?.label || 'No stage'
      : groupBy === 'project' ? row.projects[0] || 'No project'
      : groupBy === 'owner' ? row.author || 'No owner' : '';
    const groups = new Map();
    for (const row of rows) { const key = group(row); groups.set(key, [...(groups.get(key) || []), row]); }
    const ordered = [...groups.values()].flat();
    const toggle = (id) => setCollapsed((current) => {
      const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
    });
    return html`<section aria-label=${props.label || 'Pages'}>
      <div className="tmt-page-view-toolbar"><strong>${props.label || 'Pages'}</strong>
        <label>Group by <select value=${groupBy} onChange=${(event) => setGroupBy(event.target.value)}>
          <option value="state">State</option><option value="project">Project</option>
          <option value="owner">Owner</option><option value="none">None</option>
        </select></label>
        <details><summary>Columns ${visible.length}/${columns.length}</summary>
          ${columns.map(([id, label]) => html`<label key=${id}><input type="checkbox"
            checked=${visible.includes(id)} disabled=${id === 'title'}
            onChange=${(event) => setVisible((current) => event.target.checked
              ? [...current, id] : current.filter((value) => value !== id))} />${label}</label>`)}
        </details>
      </div>
      <${Table} rows=${ordered} state=${props.state && props.state !== 'auto' ? props.state : ordered.length ? 'ready' : 'empty'} empty="No matching pages" error="Page list unavailable"
        livePageView=${!props.rows}
        density=${props.density || 'compact'}
        selected=${selected} onSelectedChange=${props.selectable ? setSelected : undefined}
        visibleColumns=${visible}
        rowGroup=${groupBy === 'none' ? undefined : (row) => ({ id: group(row), label: group(row) })}
        collapsedGroups=${collapsed} onGroupToggle=${toggle} />
    </section>`;
  };
};
