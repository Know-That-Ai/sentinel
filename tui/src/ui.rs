use crate::app::{App, Tab};
use crate::views;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Clear, Padding, Paragraph, Tabs, Wrap},
};

pub fn draw(f: &mut Frame, app: &App) {
    let area = f.area();
    let filter_bar_visible = app.filter_mode || !app.filter_query.is_empty();

    let mut constraints: Vec<Constraint> = vec![
        Constraint::Length(3), // tabs
        Constraint::Min(1),    // body
    ];
    if filter_bar_visible {
        constraints.push(Constraint::Length(1)); // filter bar
    }
    constraints.push(Constraint::Length(1)); // footer

    let layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints(constraints)
        .split(area);

    render_tabs(f, layout[0], app);
    match app.tab {
        Tab::Dashboard => views::dashboard::render(f, layout[1], app),
        Tab::Sessions => views::sessions::render(f, layout[1], app),
        Tab::Events => views::events::render(f, layout[1], app),
        Tab::Audit => views::audit::render(f, layout[1], app),
        Tab::Config => views::config::render(f, layout[1], app),
    }

    if filter_bar_visible {
        render_filter_bar(f, layout[2], app);
        render_footer(f, layout[3], app);
    } else {
        render_footer(f, layout[2], app);
    }

    if app.help_visible {
        render_help_overlay(f, area, app);
    }
}

fn render_tabs(f: &mut Frame, area: Rect, app: &App) {
    let titles: Vec<Line> = Tab::ALL
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let mut spans = vec![
                Span::styled(
                    format!(" {} ", i + 1),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::raw(t.title()),
            ];
            if let Some(n) = app.badge_for(*t) {
                spans.push(Span::styled(
                    format!(" •{n}"),
                    Style::default()
                        .fg(Color::Black)
                        .bg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ));
            }
            spans.push(Span::raw(" "));
            Line::from(spans)
        })
        .collect();

    let header_text = header_line(app);

    let tabs = Tabs::new(titles)
        .select(app.tab.index())
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray))
                .title(Span::styled(
                    " 👁 sentinel ",
                    Style::default()
                        .fg(Color::Magenta)
                        .add_modifier(Modifier::BOLD),
                ))
                .title_top(Line::from(header_text).alignment(Alignment::Right)),
        )
        .highlight_style(
            Style::default()
                .fg(Color::Black)
                .bg(Color::Magenta)
                .add_modifier(Modifier::BOLD),
        )
        .divider("│");
    f.render_widget(tabs, area);
}

fn header_line(app: &App) -> Vec<Span<'_>> {
    let ok = app.snap.health.is_some();
    let dot = if ok { "●" } else { "○" };
    let color = if ok { Color::Green } else { Color::Red };
    let user = app
        .snap
        .config
        .as_ref()
        .map(|c| {
            let label = if !c.user_label.is_empty() {
                c.user_label.clone()
            } else {
                c.github_username.clone()
            };
            format!(" {} @ {} ", label, c.github_org)
        })
        .unwrap_or_default();
    vec![
        Span::styled(format!(" {} daemon ", dot), Style::default().fg(color)),
        Span::styled(user, Style::default().fg(Color::DarkGray)),
    ]
}

fn render_filter_bar(f: &mut Frame, area: Rect, app: &App) {
    let prefix = if app.filter_mode { "/" } else { "filter:" };
    let prefix_color = if app.filter_mode { Color::Cyan } else { Color::DarkGray };

    let mut spans = vec![
        Span::styled(
            format!(" {prefix} "),
            Style::default().fg(prefix_color).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            app.filter_query.clone(),
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ),
    ];
    if app.filter_mode {
        spans.push(Span::styled(
            "▏",
            Style::default().fg(Color::Cyan).add_modifier(Modifier::RAPID_BLINK),
        ));
    }
    spans.push(Span::raw("  "));
    let hint = if app.filter_mode {
        "[enter] keep · [esc] clear"
    } else {
        "[/] edit · [esc] clear"
    };
    spans.push(Span::styled(hint, Style::default().fg(Color::DarkGray)));

    let p = Paragraph::new(Line::from(spans));
    f.render_widget(p, area);
}

fn render_footer(f: &mut Frame, area: Rect, app: &App) {
    let hint = match app.tab {
        Tab::Dashboard => "[tab] switch  [r] refresh  [?] help  [q] quit",
        Tab::Sessions => "[j/k] move  [/] filter  [o] open PR  [r] refresh  [?] help  [q] quit",
        Tab::Events => "[j/k] move  [/] filter  [r] mark reviewed  [d] dispatch  [o] open  [?] help  [q] quit",
        Tab::Audit => "[j/k] move  [/] filter  [a] toggle noise  [r] refresh  [?] help  [q] quit",
        Tab::Config => "[tab] switch  [r] refresh  [?] help  [q] quit",
    };

    let mut spans = vec![Span::styled(hint, Style::default().fg(Color::DarkGray))];
    if let Some((msg, _)) = &app.flash {
        spans.push(Span::raw("  ·  "));
        spans.push(Span::styled(
            msg.clone(),
            Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
        ));
    }
    if let Some(err) = &app.snap.error {
        spans.push(Span::raw("  ·  "));
        spans.push(Span::styled(
            format!("err: {err}"),
            Style::default().fg(Color::Red),
        ));
    }
    let p = Paragraph::new(Line::from(spans)).block(Block::default().padding(Padding::horizontal(1)));
    f.render_widget(p, area);
}

fn render_help_overlay(f: &mut Frame, area: Rect, app: &App) {
    let width = area.width.saturating_sub(8).min(70);
    let height = area.height.saturating_sub(4).min(26);
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;
    let rect = Rect { x, y, width, height };

    f.render_widget(Clear, rect);

    let mut lines: Vec<Line> = Vec::new();
    lines.push(section("Navigation"));
    lines.extend([
        key_row("tab / shift-tab", "next / previous tab"),
        key_row("1 2 3 4 5", "jump to tab by number"),
        key_row("j / k  or  ↑ / ↓", "move cursor in lists"),
        key_row("q  or  ctrl-c", "quit"),
    ]);

    lines.push(Line::raw(""));
    lines.push(section("Filter & help"));
    lines.extend([
        key_row("/", "filter the current list (substring, case-insensitive)"),
        key_row("esc", "clear filter OR quit if empty"),
        key_row("?", "show / hide this overlay"),
    ]);

    lines.push(Line::raw(""));
    match app.tab {
        Tab::Dashboard => {
            lines.push(section("Dashboard"));
            lines.push(key_row("r", "refresh snapshot"));
        }
        Tab::Sessions => {
            lines.push(section("Sessions"));
            lines.extend([
                key_row("o", "open selected PR in browser"),
                key_row("r", "refresh"),
            ]);
        }
        Tab::Events => {
            lines.push(section("Events"));
            lines.extend([
                key_row("r", "mark selected event reviewed"),
                key_row("d", "dispatch selected event into its linked session"),
                key_row("o", "open event on GitHub"),
            ]);
        }
        Tab::Audit => {
            lines.push(section("Audit"));
            lines.extend([
                key_row("a", "toggle noise filter (hide/show github-actions etc.)"),
                key_row("r", "refresh"),
            ]);
        }
        Tab::Config => {
            lines.push(section("Config"));
            lines.push(key_row("r", "refresh from daemon"));
        }
    }

    lines.push(Line::raw(""));
    lines.push(Line::from(Span::styled(
        "  Any key closes this overlay.",
        Style::default().fg(Color::DarkGray),
    )));

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Magenta))
        .title(Span::styled(
            " help ",
            Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(
        Paragraph::new(lines).wrap(Wrap { trim: false }).block(block),
        rect,
    );
}

fn section(label: &str) -> Line<'_> {
    Line::from(Span::styled(
        label.to_string(),
        Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
    ))
}

fn key_row<'a>(keys: &'a str, desc: &'a str) -> Line<'a> {
    Line::from(vec![
        Span::styled(
            format!("  {:<20}", keys),
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        ),
        Span::styled(desc.to_string(), Style::default().fg(Color::White)),
    ])
}
