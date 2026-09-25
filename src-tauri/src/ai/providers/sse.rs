//! Minimal server-sent-events parsing for streamed prompt responses. The app
//! reads the whole stream before parsing (it needs the complete answer); the
//! stream only keeps bytes flowing so idle-connection cutoffs never trigger.

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SseEvent {
    pub event: String,
    pub data: String,
}

/// Splits an SSE body into events. Multi-line `data:` fields are joined with
/// newlines, `:` comment lines are ignored, and events without data (such as
/// keep-alive blocks) are dropped.
pub(crate) fn parse_events(body: &str) -> Vec<SseEvent> {
    let mut events = Vec::new();
    let mut event = String::new();
    let mut data_lines: Vec<&str> = Vec::new();

    let mut flush = |event: &mut String, data_lines: &mut Vec<&str>| {
        if !data_lines.is_empty() {
            events.push(SseEvent {
                event: std::mem::take(event),
                data: data_lines.join("\n"),
            });
        }
        event.clear();
        data_lines.clear();
    };

    for raw_line in body.split('\n') {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if line.is_empty() {
            flush(&mut event, &mut data_lines);
            continue;
        }
        if line.starts_with(':') {
            continue;
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "event" => event = value.to_string(),
            "data" => data_lines.push(value),
            _ => {}
        }
    }
    flush(&mut event, &mut data_lines);

    events
}

#[cfg(test)]
mod tests {
    use super::{parse_events, SseEvent};

    #[test]
    fn parses_events_comments_multiline_data_and_crlf() {
        let body = ": keep-alive\r\n\r\nevent: ping\r\ndata: {}\r\n\r\n\
                    event: message\ndata: first\ndata: second\n\n\
                    data: no event name\n";

        assert_eq!(
            parse_events(body),
            vec![
                SseEvent {
                    event: "ping".to_string(),
                    data: "{}".to_string(),
                },
                SseEvent {
                    event: "message".to_string(),
                    data: "first\nsecond".to_string(),
                },
                SseEvent {
                    event: String::new(),
                    data: "no event name".to_string(),
                },
            ]
        );
    }

    #[test]
    fn empty_body_has_no_events() {
        assert!(parse_events("").is_empty());
        assert!(parse_events(": only a comment\n\n").is_empty());
    }
}
