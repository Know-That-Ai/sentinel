pub mod audit;
pub mod config;
pub mod dashboard;
pub mod events;
pub mod sessions;

use chrono::{DateTime, Utc};

pub fn relative_time(iso: &str) -> String {
    let Ok(t) = DateTime::parse_from_rfc3339(iso) else {
        return iso.to_string();
    };
    let now = Utc::now();
    let diff = now.signed_duration_since(t.with_timezone(&Utc));
    let secs = diff.num_seconds();
    if secs < 0 {
        return "just now".into();
    }
    if secs < 60 {
        return format!("{secs}s ago");
    }
    let mins = secs / 60;
    if mins < 60 {
        return format!("{mins}m ago");
    }
    let hours = mins / 60;
    if hours < 24 {
        return format!("{hours}h ago");
    }
    let days = hours / 24;
    format!("{days}d ago")
}
