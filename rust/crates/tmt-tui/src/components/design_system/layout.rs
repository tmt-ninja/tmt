use super::Rect;
use serde::{Deserialize, Serialize};
/// A fixed track, or a weighted share of the space left after fixed tracks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Track {
    Fixed(u16),
    Fill(u16),
}
/// Split an area into rows or columns, clipping fixed tracks and distributing remainder deterministically.
pub fn split(area: Rect, tracks: &[Track], horizontal: bool) -> Vec<Rect> {
    let available = if horizontal { area.width } else { area.height };
    let fixed: u32 = tracks
        .iter()
        .map(|t| match t {
            Track::Fixed(n) => u32::from(*n),
            Track::Fill(_) => 0,
        })
        .sum();
    let free = u32::from(available).saturating_sub(fixed);
    let weight: u32 = tracks
        .iter()
        .map(|t| match t {
            Track::Fill(n) => u32::from(*n),
            _ => 0,
        })
        .sum();
    let mut offset = 0u16;
    let mut allocated = 0u32;
    let mut seen = 0u32;
    tracks
        .iter()
        .map(|track| {
            let want = match track {
                Track::Fixed(n) => u32::from(*n),
                Track::Fill(n) if weight > 0 => {
                    seen += u32::from(*n);
                    let end = free * seen / weight;
                    let width = end - allocated;
                    allocated = end;
                    width
                }
                Track::Fill(_) => 0,
            };
            let length = want.min(u32::from(available.saturating_sub(offset))) as u16;
            let r = if horizontal {
                Rect {
                    x: area.x.saturating_add(offset),
                    width: length,
                    ..area
                }
            } else {
                Rect {
                    y: area.y.saturating_add(offset),
                    height: length,
                    ..area
                }
            };
            offset += length;
            r
        })
        .collect()
}

/// Lay out fixed and fill tracks from left to right.
pub fn row(area: Rect, tracks: &[Track]) -> Vec<Rect> {
    split(area, tracks, true)
}

/// Lay out fixed and fill tracks from top to bottom.
pub fn column(area: Rect, tracks: &[Track]) -> Vec<Rect> {
    split(area, tracks, false)
}
