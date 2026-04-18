use crate::api::WebhookLogEntry;
use crate::app::App;
use crate::views::relative_time;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, List, ListItem, Padding, Paragraph, Wrap},
};

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let entries = app.audit_entries();
    if entries.is_empty() {
        render_empty(f, area, app);
        return;
    }

    let layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(55), Constraint::Percentage(45)])
        .split(area);

    render_list(f, layout[0], app, &entries);
    render_detail(f, layout[1], app, &entries);
}

fn render_list(f: &mut Frame, area: Rect, app: &App, entries: &[&WebhookLogEntry]) {
    let items: Vec<ListItem> = entries
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let selected = i == app.audit_cursor;
            let arrow = if selected { "▶ " } else { "  " };
            let (disp_color, disp_label) = disposition_style(&e.disposition);

            let header = Line::from(vec![
                Span::styled(arrow, Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD)),
                Span::styled(
                    format!("{:<10}", disp_label),
                    Style::default().fg(disp_color).add_modifier(Modifier::BOLD),
                ),
                Span::raw(" "),
                Span::styled(
                    format!("{:<30}", e.event_type),
                    Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    e.action.clone().unwrap_or_else(|| "-".into()),
                    Style::default().fg(Color::DarkGray),
                ),
            ]);

            let repo_pr = match (&e.repo, e.pr_number) {
                (Some(r), Some(n)) => format!("{r} #{n}"),
                (Some(r), None) => r.clone(),
                _ => "-".into(),
            };
            let info = Line::from(vec![
                Span::raw("    "),
                Span::styled(
                    e.actor.clone().unwrap_or_else(|| "-".into()),
                    Style::default().fg(Color::Cyan),
                ),
                Span::raw("  "),
                Span::styled(repo_pr, Style::default().fg(Color::Gray)),
                Span::raw("  "),
                Span::styled(
                    relative_time(&e.received_at),
                    Style::default().fg(Color::DarkGray),
                ),
            ]);

            let style = if selected {
                Style::default().bg(Color::Rgb(40, 40, 60))
            } else {
                Style::default()
            };
            ListItem::new(vec![header, info, Line::raw("")]).style(style)
        })
        .collect();

    let hidden_count = app.snap.webhook_log.len().saturating_sub(entries.len());
    let title = if app.audit_show_all {
        format!(" webhook audit  ·  showing all {} ", app.snap.webhook_log.len())
    } else if hidden_count > 0 {
        format!(
            " webhook audit  ·  {} interesting · {} hidden (press a) ",
            entries.len(),
            hidden_count
        )
    } else {
        format!(" webhook audit  ·  {} ", entries.len())
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            title,
            Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
        ))
        .padding(Padding::horizontal(1));
    f.render_widget(List::new(items).block(block), area);
}

fn render_detail(f: &mut Frame, area: Rect, app: &App, entries: &[&WebhookLogEntry]) {
    let Some(e) = entries.get(app.audit_cursor) else {
        return;
    };

    let (disp_color, disp_label) = disposition_style(&e.disposition);

    let lines = vec![
        Line::from(vec![
            Span::styled(
                format!("{}  ", disp_label),
                Style::default().fg(disp_color).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                e.event_type.clone(),
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled(
                e.action.clone().unwrap_or_else(|| "-".into()),
                Style::default().fg(Color::DarkGray),
            ),
        ]),
        Line::raw(""),
        kv("reason  ", e.reason.as_deref().unwrap_or("-")),
        kv(
            "repo    ",
            &e.repo.clone().unwrap_or_else(|| "-".into()),
        ),
        kv(
            "PR      ",
            &e.pr_number.map(|n| format!("#{n}")).unwrap_or_else(|| "-".into()),
        ),
        kv(
            "actor   ",
            &e.actor.clone().unwrap_or_else(|| "-".into()),
        ),
        kv("received", &relative_time(&e.received_at)),
        kv("at      ", &e.received_at),
        kv(
            "delivery",
            &e.delivery_id.clone().unwrap_or_else(|| "-".into()),
        ),
        Line::raw(""),
        Line::styled(explainer(&e.disposition, e.reason.as_deref()), Style::default().fg(Color::DarkGray)),
    ];

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

fn render_empty(f: &mut Frame, area: Rect, app: &App) {
    let total = app.snap.webhook_log.len();
    let msg = if total == 0 {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                "  No webhooks received yet.",
                Style::default().fg(Color::DarkGray),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "  Every incoming webhook — dispatched, notified, or dropped — will appear here with a reason.",
                Style::default().fg(Color::DarkGray),
            )),
        ]
    } else {
        vec![
            Line::from(""),
            Line::from(vec![
                Span::styled("  Inbox zero on the interesting stuff — ", Style::default().fg(Color::Green)),
                Span::styled(
                    format!("{total} webhook(s) hidden by the default filter."),
                    Style::default().fg(Color::DarkGray),
                ),
            ]),
            Line::from(""),
            Line::from(Span::styled(
                "  Press [a] to show all.",
                Style::default().fg(Color::DarkGray),
            )),
        ]
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(" webhook audit ");
    f.render_widget(Paragraph::new(msg).wrap(Wrap { trim: true }).block(block), area);
}

fn disposition_style(d: &str) -> (Color, &'static str) {
    match d {
        "dispatched" => (Color::Green, "DISPATCHED"),
        "notified" => (Color::Yellow, "NOTIFIED  "),
        "dropped" => (Color::Red, "DROPPED   "),
        "auto_closed" => (Color::Blue, "AUTO-CLOSE"),
        _ => (Color::White, "?         "),
    }
}

fn kv<'a>(label: &'a str, value: &str) -> Line<'a> {
    Line::from(vec![
        Span::styled(format!("{label}  "), Style::default().fg(Color::DarkGray)),
        Span::styled(value.to_string(), Style::default().fg(Color::White)),
    ])
}

fn explainer(disposition: &str, reason: Option<&str>) -> String {
    match (disposition, reason) {
        ("dispatched", _) => "Injected into the linked Claude session.".into(),
        ("notified", Some("no_linked_session")) => {
            "No Claude session is linked to this PR — sent a menu-bar notification instead.".into()
        }
        ("notified", _) => "Sent a notification; no active link matched.".into(),
        ("auto_closed", Some(r)) if r.starts_with("scanner_check_success") => {
            "Scanner re-ran and passed — all open findings from that scanner on this PR were marked resolved.".into()
        }
        ("auto_closed", Some("review_comment_deleted")) => {
            "Scanner deleted the review comment — the matching event was marked resolved.".into()
        }
        ("auto_closed", Some("issue_comment_deleted")) => {
            "Scanner deleted the PR comment — the matching event was marked resolved.".into()
        }
        ("auto_closed", Some(r)) => format!("Auto-closed: {r}"),
        ("dropped", Some("actor_not_in_scanner_list")) => {
            "Event sender isn't in SCANNER_BOT_LOGINS — add their login to .env if this should fire.".into()
        }
        ("dropped", Some("check_has_no_pr")) => {
            "GitHub's check_run payload didn't include a PR number — common for branch checks not tied to a PR.".into()
        }
        ("dropped", Some("unhandled_event_type")) => {
            "Sentinel doesn't have a handler for this event type. The webhook subscription may include events we don't process.".into()
        }
        ("dropped", Some("delete_no_matching_event")) => {
            "Scanner deleted a comment that wasn't tracked here — either it predates Sentinel linking this PR, or the event was already reviewed.".into()
        }
        ("dropped", Some(r)) if r.starts_with("action_") => {
            "This action variant isn't one we act on (e.g. comment 'edited' rather than 'created').".into()
        }
        ("dropped", Some("ping")) => "GitHub's ping event on webhook setup.".into(),
        ("dropped", Some(r)) => format!("Dropped: {r}"),
        _ => String::new(),
    }
}
