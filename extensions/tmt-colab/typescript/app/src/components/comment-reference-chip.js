// This source is embedded into the opaque page renderer by generate-renderer-style.mjs.
// It receives only the parent's admitted display projection and grants no record authority.
// eslint-disable-next-line no-unused-vars -- embedded and called by the renderer
function commentReferenceChip(frameNode, entry, activate) {
  const chip = frameNode(entry ? 'button' : 'span');
  chip.dataset.colabRefChip = '';
  chip.className = 'colab-thread-ref-chip';
  if (!entry) {
    chip.textContent = 'Thread not found';
    chip.dataset.missing = '';
    return chip;
  }
  chip.type = 'button';
  chip.setAttribute('aria-label', `Open thread ${entry.number}: ${entry.excerpt}`);
  const icon = frameNode('tmt-icon');
  icon.setAttribute('name', 'message-circle');
  icon.setAttribute('aria-hidden', 'true');
  chip.append(icon, document.createTextNode(`${entry.number} · ${entry.excerpt}`));
  chip.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    activate(entry.id);
  });
  return chip;
}
