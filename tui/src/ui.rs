use crate::app::{App, Tab};
use crate::views;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Padding, Paragraph, Tabs},
};

pub fn draw(f: &mut Frame, app: &App) {
    let area = f.area();
    let layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // tabs
            Constraint::Min(1),    // body
            Constraint::Length(1), // footer
        ])
        .split(area);

    render_tabs(f, layout[0], app);
    match app.tab {
        Tab::Dashboard => views::dashboard::render(f, layout[1], app),
        Tab::Sessions => views::sessions::render(f, layout[1], app),
        Tab::Events => views::events::render(f, layout[1], app),
        Tab::Audit => views::audit::render(f, layout[1], app),
        Tab::Config => views::config::render(f, layout[1], app),
    }
    render_footer(f, layout[2], app);
}

fn render_tabs(f: &mut Frame, area: Rect, app: &App) {
    let titles: Vec<Line> = Tab::ALL
        .iter()
        .enumerate()
        .map(|(i, t)| {
            Line::from(vec![
                Span::styled(
                    format!(" {} ", i + 1),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::raw(t.title()),
                Span::raw(" "),
            ])
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

fn render_footer(f: &mut Frame, area: Rect, app: &App) {
    let hint = match app.tab {
        Tab::Dashboard => "[tab] switch  [r] refresh  [q] quit",
        Tab::Sessions => "[j/k] move  [o] open PR  [r] refresh  [q] quit",
        Tab::Events => "[j/k] move  [r] mark reviewed  [d] dispatch  [o] open  [q] quit",
        Tab::Audit => "[j/k] move  [r] refresh  [q] quit",
        Tab::Config => "[tab] switch  [r] refresh  [q] quit",
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
