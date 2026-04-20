use crate::api::{Event, Session};
use crate::app::App;
use crate::theme::Theme;
use crate::views::relative_time;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, List, ListItem, Padding, Paragraph, Wrap},
};

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let events = app.filtered_events();
    if events.is_empty() {
        render_empty(f, area, app);
        return;
    }

    let layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(55), Constraint::Percentage(45)])
        .split(area);

    render_list(f, layout[0], app, &events);
    render_detail(f, layout[1], app, &events);
}

fn render_list(f: &mut Frame, area: Rect, app: &App, events: &[&Event]) {
    let t = app.theme;
    let items: Vec<ListItem> = events
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let selected = i == app.events_cursor;
            let arrow = if selected { "▶ " } else { "  " };
            let src_color = source_color(&e.source, t);
            let linked = find_linked_session(app, e).is_some();

            let mut header_spans = vec![
                Span::styled(
                    arrow,
                    Style::default().fg(t.primary).add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("[{:<7}]", e.source),
                    Style::default().fg(src_color).add_modifier(Modifier::BOLD),
                ),
                Span::raw("  "),
                Span::styled(
                    format!("{} #{}", e.repo, e.pr_number),
                    Style::default().fg(t.text).add_modifier(Modifier::BOLD),
                ),
                Span::raw("  "),
                Span::styled(
                    format!("@{}", e.pr_author),
                    Style::default().fg(t.accent),
                ),
                Span::raw("  "),
                Span::styled(
                    relative_time(&e.received_at),
                    Style::default().fg(t.muted),
                ),
            ];
            if !linked {
                header_spans.push(Span::raw("  "));
                header_spans.push(Span::styled(
                    "[unlinked]",
                    Style::default().fg(t.warning),
                ));
            }
            let header = Line::from(header_spans);

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
                Span::styled(body, Style::default().fg(t.muted)),
            ]);

            let style = if selected {
                Style::default().bg(t.highlight_bg)
            } else if !linked {
                Style::default().add_modifier(Modifier::DIM)
            } else {
                Style::default()
            };
            ListItem::new(vec![header, body_line, Line::raw("")]).style(style)
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(t.border))
            .title(Span::styled(
                " unreviewed events ",
                Style::default().fg(t.warning).add_modifier(Modifier::BOLD),
            ))
            .padding(Padding::horizontal(1)),
    );
    f.render_widget(list, area);
}

fn render_detail(f: &mut Frame, area: Rect, app: &App, events: &[&Event]) {
    let t = app.theme;
    let Some(ev) = events.get(app.events_cursor).copied() else {
        return;
    };

    let linked = find_linked_session(app, ev);
    let dispatch_status = match &linked {
        Some(s) => Line::from(vec![
            Span::styled("will dispatch into  ", Style::default().fg(t.muted)),
            Span::styled(
                format!("{} → {}", s.agent_type, s.repo_path),
                Style::default().fg(t.success),
            ),
        ]),
        None => Line::from(vec![
            Span::styled("no linked session  ", Style::default().fg(t.muted)),
            Span::styled(
                "(falls back to notification)",
                Style::default().fg(t.warning),
            ),
        ]),
    };

    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                format!("[{}]  ", ev.source),
                Style::default()
                    .fg(source_color(&ev.source, t))
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                ev.actor.clone(),
                Style::default().fg(t.text).add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::raw(""),
        Line::from(vec![
            Span::styled("PR       ", Style::default().fg(t.muted)),
            Span::raw(format!("{} #{} — {}", ev.repo, ev.pr_number, ev.pr_title)),
        ]),
        Line::from(vec![
            Span::styled("author   ", Style::default().fg(t.muted)),
            Span::raw(ev.pr_author.clone()),
        ]),
        Line::from(vec![
            Span::styled("received ", Style::default().fg(t.muted)),
            Span::raw(relative_time(&ev.received_at)),
        ]),
        Line::raw(""),
        dispatch_status,
        Line::raw(""),
        Line::styled("body", Style::default().fg(t.muted)),
    ];
    for line in ev.body.as_deref().unwrap_or("(no body)").lines().take(20) {
        lines.push(Line::from(Span::styled(
            format!("  {line}"),
            Style::default().fg(t.text),
        )));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(Span::styled(
            " detail ",
            Style::default().fg(t.warning),
        ))
        .padding(Padding::new(2, 2, 1, 1));
    f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }).block(block), area);
}

fn render_empty(f: &mut Frame, area: Rect, app: &App) {
    let t = app.theme;
    let has_query = !app.filter_query.is_empty();
    let total = app.snap.events.len();
    let msg = if has_query && total > 0 {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                format!("  No events match filter \"{}\".", app.filter_query),
                Style::default().fg(t.muted),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "  Press Esc to clear.",
                Style::default().fg(t.muted),
            )),
        ]
    } else {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                "  Inbox zero 🎉 — no unreviewed events.",
                Style::default().fg(t.success),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "  New scanner comments will show up here.",
                Style::default().fg(t.muted),
            )),
        ]
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(t.border))
        .title(" unreviewed events ");
    f.render_widget(Paragraph::new(msg).block(block), area);
}

fn find_linked_session<'a>(app: &'a App, ev: &Event) -> Option<&'a Session> {
    app.snap
        .sessions
        .iter()
        .find(|s| {
            s.repo.eq_ignore_ascii_case(&ev.repo)
                && s.pr_number == ev.pr_number
                && s.unlinked_at.is_none()
        })
}

fn source_color(source: &str, t: Theme) -> Color {
    match source {
        "bugbot" => t.error,
        "codeql" => t.warning,
        "ci" => t.info,
        _ => t.text,
    }
}
