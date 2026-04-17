use crate::api::{Event, Session};
use crate::app::App;
use crate::views::relative_time;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, List, ListItem, Padding, Paragraph, Wrap},
};

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    if app.snap.events.is_empty() {
        render_empty(f, area);
        return;
    }

    let layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(55), Constraint::Percentage(45)])
        .split(area);

    render_list(f, layout[0], app);
    render_detail(f, layout[1], app);
}

fn render_list(f: &mut Frame, area: Rect, app: &App) {
    let items: Vec<ListItem> = app
        .snap
        .events
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let selected = i == app.events_cursor;
            let arrow = if selected { "▶ " } else { "  " };
            let source_color = source_color(&e.source);

            let header = Line::from(vec![
                Span::styled(
                    arrow,
                    Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("[{:<7}]", e.source),
                    Style::default().fg(source_color).add_modifier(Modifier::BOLD),
                ),
                Span::raw("  "),
                Span::styled(
                    format!("{} #{}", e.repo, e.pr_number),
                    Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                ),
                Span::raw("  "),
                Span::styled(
                    relative_time(&e.received_at),
                    Style::default().fg(Color::DarkGray),
                ),
            ]);

            let body = e
                .body
                .as_deref()
                .unwrap_or("(no body)")
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(70)
                .collect::<String>();
            let body_line = Line::from(vec![
                Span::raw("    "),
                Span::styled(body, Style::default().fg(Color::Gray)),
            ]);

            let style = if selected {
                Style::default().bg(Color::Rgb(40, 40, 60))
            } else {
                Style::default()
            };
            ListItem::new(vec![header, body_line, Line::raw("")]).style(style)
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray))
            .title(Span::styled(
                " unreviewed events ",
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            ))
            .padding(Padding::horizontal(1)),
    );
    f.render_widget(list, area);
}

fn render_detail(f: &mut Frame, area: Rect, app: &App) {
    let Some(ev) = app.selected_event() else {
        return;
    };

    let linked = find_linked_session(app, ev);
    let dispatch_status = match &linked {
        Some(s) => Line::from(vec![
            Span::styled(
                "will dispatch into  ",
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled(
                format!("{} → {}", s.agent_type, s.repo_path),
                Style::default().fg(Color::Green),
            ),
        ]),
        None => Line::from(vec![
            Span::styled(
                "no linked session  ",
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled(
                "(falls back to notification)",
                Style::default().fg(Color::Yellow),
            ),
        ]),
    };

    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                format!("[{}]  ", ev.source),
                Style::default()
                    .fg(source_color(&ev.source))
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                ev.actor.clone(),
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::raw(""),
        Line::from(vec![
            Span::styled("PR       ", Style::default().fg(Color::DarkGray)),
            Span::raw(format!("{} #{} — {}", ev.repo, ev.pr_number, ev.pr_title)),
        ]),
        Line::from(vec![
            Span::styled("author   ", Style::default().fg(Color::DarkGray)),
            Span::raw(ev.pr_author.clone()),
        ]),
        Line::from(vec![
            Span::styled("received ", Style::default().fg(Color::DarkGray)),
            Span::raw(relative_time(&ev.received_at)),
        ]),
        Line::raw(""),
        dispatch_status,
        Line::raw(""),
        Line::styled("body", Style::default().fg(Color::DarkGray)),
    ];
    for line in ev.body.as_deref().unwrap_or("(no body)").lines().take(20) {
        lines.push(Line::from(Span::styled(
            format!("  {line}"),
            Style::default().fg(Color::White),
        )));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            " detail ",
            Style::default().fg(Color::Yellow),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
}

fn render_empty(f: &mut Frame, area: Rect) {
    let msg = vec![
        Line::from(""),
        Line::from(Span::styled(
            "  Inbox zero 🎉 — no unreviewed events.",
            Style::default().fg(Color::Green),
        )),
        Line::from(""),
        Line::from(Span::styled(
            "  New scanner comments will show up here.",
            Style::default().fg(Color::DarkGray),
        )),
    ];
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" unreviewed events ");
    f.render_widget(Paragraph::new(msg).block(block), area);
}

fn find_linked_session<'a>(app: &'a App, ev: &Event) -> Option<&'a Session> {
    app.snap
        .sessions
        .iter()
        .find(|s| s.repo == ev.repo && s.pr_number == ev.pr_number && s.unlinked_at.is_none())
}

fn source_color(source: &str) -> Color {
    match source {
        "bugbot" => Color::Red,
        "codeql" => Color::Yellow,
        "ci" => Color::Blue,
        _ => Color::White,
    }
}
