use serde::{Deserialize, Deserializer, Serialize, Serializer};
use tmt_cli_style::theme::Role;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

/// A semantic color role, serialized using the existing design-token name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Token(pub Role);
impl Serialize for Token {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.0.name())
    }
}
impl<'de> Deserialize<'de> for Token {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let name = String::deserialize(deserializer)?;
        Role::parse(&name)
            .map(Self)
            .ok_or_else(|| serde::de::Error::custom("unknown style role"))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Size {
    pub width: u16,
    pub height: u16,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Constraints {
    pub min: Size,
    pub max: Size,
}

impl Constraints {
    pub fn clamp(self, size: Size) -> Size {
        Size {
            width: size
                .width
                .max(self.min.width.min(self.max.width))
                .min(self.max.width),
            height: size
                .height
                .max(self.min.height.min(self.max.height))
                .min(self.max.height),
        }
    }
}

mod optional_role_serde {
    use super::*;
    pub fn serialize<S: Serializer>(role: &Option<Role>, serializer: S) -> Result<S::Ok, S::Error> {
        role.map(Token).serialize(serializer)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Role>, D::Error> {
        Option::<Token>::deserialize(deserializer).map(|token| token.map(|value| value.0))
    }
}

/// Semantic secondary-chip surfaces resolved by the presentation adapter.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChipSurface {
    /// The normal unselected surface.
    Idle,
    /// A selected, focused, or hovered surface.
    Hot,
    /// A disabled surface that cannot be activated.
    Disabled,
}

/// Continuations occupy the extra cells of a wide grapheme.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cell {
    pub glyph: String,
    /// A role already on the cell, before the foreground role is applied.
    #[serde(with = "optional_role_serde")]
    pub underlay: Option<Role>,
    #[serde(with = "optional_role_serde")]
    pub fg: Option<Role>,
    #[serde(with = "optional_role_serde")]
    pub bg: Option<Role>,
    pub bold: bool,
    pub chip_surface: Option<ChipSurface>,
    pub continuation: bool,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            glyph: " ".into(),
            underlay: None,
            fg: None,
            bg: None,
            bold: false,
            chip_surface: None,
            continuation: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CellGrid {
    size: Size,
    cells: Vec<Cell>,
}

impl CellGrid {
    pub fn new(size: Size) -> Self {
        Self {
            size,
            cells: vec![Cell::default(); usize::from(size.width) * usize::from(size.height)],
        }
    }

    pub fn size(&self) -> Size {
        self.size
    }

    pub fn get(&self, x: u16, y: u16) -> Option<&Cell> {
        (x < self.size.width && y < self.size.height)
            .then(|| &self.cells[usize::from(y) * usize::from(self.size.width) + usize::from(x)])
    }

    pub fn set(&mut self, x: u16, y: u16, cell: Cell) {
        if x < self.size.width && y < self.size.height {
            self.cells[usize::from(y) * usize::from(self.size.width) + usize::from(x)] = cell;
        }
    }

    /// Write complete graphemes only; never emit a partial wide character.
    pub fn text(&mut self, area: Rect, text: &str, fg: Role, bg: Option<Role>) {
        self.text_with(area, text, Some(fg), bg, false);
    }

    /// Write a line with explicit semantic emphasis.
    pub fn text_bold(&mut self, area: Rect, text: &str, fg: Role, bg: Option<Role>, bold: bool) {
        self.text_with(area, text, Some(fg), bg, bold);
    }

    /// Write with an optional inherited foreground role.
    pub fn text_with(
        &mut self,
        area: Rect,
        text: &str,
        fg: Option<Role>,
        bg: Option<Role>,
        bold: bool,
    ) {
        let mut x = area.x;
        let end = area.x.saturating_add(area.width).min(self.size.width);
        if area.y >= self.size.height || area.height == 0 {
            return;
        }
        for grapheme in text.graphemes(true) {
            let width = UnicodeWidthStr::width(grapheme);
            if width == 0 {
                continue;
            }
            if usize::from(end.saturating_sub(x)) < width {
                break;
            }
            self.set(
                x,
                area.y,
                Cell {
                    glyph: grapheme.into(),
                    underlay: None,
                    fg,
                    bg,
                    bold,
                    chip_surface: None,
                    continuation: false,
                },
            );
            for dx in 1..width {
                self.set(
                    x + dx as u16,
                    area.y,
                    Cell {
                        glyph: String::new(),
                        underlay: None,
                        fg,
                        bg,
                        bold,
                        chip_surface: None,
                        continuation: true,
                    },
                );
            }
            x += width as u16;
        }
    }

    /// Paint a chip with its semantic surface; no palette is resolved here.
    pub fn chip(&mut self, area: Rect, text: &str, surface: ChipSurface) {
        self.text(area, text, Role::Text, None);
        for y in area.y..area.y.saturating_add(area.height).min(self.size.height) {
            for x in area.x..area.x.saturating_add(area.width).min(self.size.width) {
                let index = usize::from(y) * usize::from(self.size.width) + usize::from(x);
                self.cells[index].chip_surface = Some(surface);
            }
        }
    }

    pub fn clear(&mut self, area: Rect) {
        for y in area.y..area.y.saturating_add(area.height).min(self.size.height) {
            for x in area.x..area.x.saturating_add(area.width).min(self.size.width) {
                self.set(
                    x,
                    y,
                    Cell {
                        fg: Some(Role::Text),
                        ..Cell::default()
                    },
                );
            }
        }
    }
}

/// Opaque ID supplied by the caller, never an application action.
pub type HitId = u64;
pub trait Component {
    type Props: Serialize + serde::de::DeserializeOwned;
    fn measure(props: &Self::Props, constraints: Constraints) -> Size;
    fn render(props: &Self::Props, area: Rect, buffer: &mut CellGrid) -> Vec<(Rect, HitId)>;
}
