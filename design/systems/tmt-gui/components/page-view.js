// Runtime 4 supplies the real browser-ui PageView, the same part the trusted parent paints a live
// list with. Authored `rows` show here; a live view (no `rows`) holds its slot as a loading view
// under the parent's list, and no page record reaches this frame.
const parse = (text, fallback) => {
  try {
    const value = JSON.parse(text || '');
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
};
const str = (value) => (typeof value === 'string' ? value : '');

export default ({ React, ui }) =>
  function PageViewTag(props) {
    const live = !props.rows;
    const [filters, setFilters] = React.useState(() =>
      parse(props.filters, [])
        .filter(
          (filter) =>
            filter &&
            ['project', 'state', 'owner'].includes(filter.field) &&
            typeof filter.value === 'string',
        )
        .slice(0, 20),
    );
    const limit = Math.max(1, Math.min(200, Number(props.limit) || 20));
    const rows = React.useMemo(() => {
      const authored = parse(props.rows, [])
        .slice(0, 200)
        .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
        .map((item) => ({
          id: item.id,
          name: item.name,
          title: item.name,
          projects: Array.isArray(item.projects)
            ? item.projects.filter((value) => typeof value === 'string')
            : [],
          stage: typeof item.stage === 'string' ? { id: item.stage, label: item.stage } : undefined,
          updated: str(item.updated),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
          subpages:
            item.subpages &&
            Number.isSafeInteger(item.subpages.done) &&
            Number.isSafeInteger(item.subpages.total) &&
            item.subpages.total > 0 &&
            item.subpages.done >= 0 &&
            item.subpages.done <= item.subpages.total
              ? item.subpages
              : undefined,
          needsYou: item.needsYou === true,
          author: str(item.author),
          access: str(item.access) || 'Team',
        }))
        .filter((row) =>
          filters.every(({ field, value }) =>
            field === 'project'
              ? row.projects.includes(value)
              : field === 'state'
                ? row.stage?.id === value || row.stage?.label === value
                : row.author === value,
          ),
        );
      authored.sort((a, b) =>
        props.sort === 'title' ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt,
      );
      return authored.slice(0, limit);
    }, [props.rows, props.sort, limit, filters]);
    const columns = parse(props.columns, undefined);
    return React.createElement(ui.PageView, {
      title: props.label || 'Pages',
      rows,
      filters: filters.map((filter, index) => ({
        id: String(index),
        label: `${filter.field}: ${filter.value}`,
      })),
      state: live
        ? 'loading'
        : ['loading', 'empty', 'error'].includes(props.state)
          ? props.state
          : 'ready',
      groupBy: ['project', 'owner', 'none'].includes(props['group-by']) ? props['group-by'] : 'state',
      columns,
      density: props.density === 'comfortable' ? 'comfortable' : 'compact',
      selectable: !!props.selectable,
      selected: props.selected,
      onRemoveFilter: (id) => setFilters((old) => old.filter((_, index) => String(index) !== id)),
    });
  };
