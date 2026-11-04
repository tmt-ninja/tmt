export default ({ React, ui }) => ({ undo, ...props }) => React.createElement(ui.BlockToast, { ...props, undoLabel: undo });
