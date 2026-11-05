export default ({ React, ui }) => ({ heading, ...props }) => React.createElement(ui.CardBlock, { ...props, title: heading });
