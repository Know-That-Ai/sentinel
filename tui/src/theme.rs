//! Centralized color palette for the TUI.
//!
//! Swap the whole look with `SENTINEL_THEME=claude|classic|mono` before
//! launching `sentinel tui`. Default is `claude` — the warm-amber palette
//! matching Claude Code's accent color, on a zinc-grayscale base.

use ratatui::style::Color;

#[derive(Clone, Copy, Debug)]
pub struct Theme {
    /// Dominant accent — active tab highlight, panel titles, signature marks.
    pub primary: Color,
    /// Secondary accent — ids, links, repo names.
    pub accent: Color,
    /// Primary text color.
    pub text: Color,
    /// Secondary / label text color.
    pub muted: Color,
    /// Block border color.
    pub border: Color,
    /// Selected row / tab background.
    pub selected_bg: Color,
    /// Selected row / tab foreground (on top of selected_bg).
    pub selected_fg: Color,
    /// Non-tab row highlight (list selection subtle bg).
    pub highlight_bg: Color,
    pub success: Color,
    pub warning: Color,
    pub error: Color,
    /// Auto-closed and other informational states.
    pub info: Color,
    pub badge_bg: Color,
    pub badge_fg: Color,
    pub sparkline: Color,
}

impl Theme {
    /// Claude Code–inspired palette. Warm amber primary, cyan accent, zinc
    /// grayscale for chrome. This is the default.
    pub const fn claude() -> Self {
        Self {
            primary: Color::Rgb(217, 119, 6),     // amber-600
            accent: Color::Rgb(34, 211, 238),     // cyan-400
            text: Color::Rgb(250, 250, 250),      // zinc-50
            muted: Color::Rgb(113, 113, 122),     // zinc-500
            border: Color::Rgb(63, 63, 70),       // zinc-700
            selected_bg: Color::Rgb(217, 119, 6), // amber-600
            selected_fg: Color::Black,
            highlight_bg: Color::Rgb(39, 39, 42), // zinc-800
            success: Color::Rgb(34, 197, 94),     // green-500
            warning: Color::Rgb(234, 179, 8),     // yellow-500
            error: Color::Rgb(239, 68, 68),       // red-500
            info: Color::Rgb(59, 130, 246),       // blue-500
            badge_bg: Color::Rgb(234, 179, 8),    // yellow-500
            badge_fg: Color::Black,
            sparkline: Color::Rgb(249, 115, 22),  // orange-500
        }
    }

    /// The original ratatui-default magenta/cyan palette.
    pub const fn classic() -> Self {
        Self {
            primary: Color::Magenta,
            accent: Color::Cyan,
            text: Color::White,
            muted: Color::DarkGray,
            border: Color::DarkGray,
            selected_bg: Color::Magenta,
            selected_fg: Color::Black,
            highlight_bg: Color::Rgb(40, 40, 60),
            success: Color::Green,
            warning: Color::Yellow,
            error: Color::Red,
            info: Color::Blue,
            badge_bg: Color::Yellow,
            badge_fg: Color::Black,
            sparkline: Color::Cyan,
        }
    }

    /// High-contrast monochrome for e-ink / accessibility.
    pub const fn mono() -> Self {
        Self {
            primary: Color::White,
            accent: Color::Gray,
            text: Color::White,
            muted: Color::Gray,
            border: Color::DarkGray,
            selected_bg: Color::White,
            selected_fg: Color::Black,
            highlight_bg: Color::Rgb(30, 30, 30),
            success: Color::White,
            warning: Color::White,
            error: Color::White,
            info: Color::White,
            badge_bg: Color::White,
            badge_fg: Color::Black,
            sparkline: Color::White,
        }
    }

    pub fn from_env() -> Self {
        match std::env::var("SENTINEL_THEME")
            .ok()
            .as_deref()
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("classic") | Some("default") => Self::classic(),
            Some("mono") => Self::mono(),
            _ => Self::claude(),
        }
    }
}
