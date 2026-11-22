# Questions on block pages

Create a structured page and add the question beside the passage it concerns:

```sh
tmt colab page create --title 'Decision' --json
tmt colab block batch PAGE --file ops.json --json
```

Use the returned page ID for PAGE. Save this as `ops.json`:

```json
[{"op":"insert","id":"10000000-0000-4000-8000-000000000001","type":"question","text":"Which day works?","props":{"kind":"single","choices":["Monday","Friday"]}}]
```

The batch registers each question automatically. Answers follow the registry assignee or the page creator. Use [blocks](blocks.md) for edits. Grouped questions require [legacy HTML pages](legacy-html.md) (`tmt colab skill legacy-html`).
