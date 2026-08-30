use chrono::NaiveDate;
use marked_yaml::{LoaderOptions, Node, parse_yaml_with_options};
use thiserror::Error;
use uuid::Uuid;

const OWNED_KEYS: &[&str] = &[
    "Kanleaf ID",
    "Reference",
    "Title",
    "Project",
    "State",
    "Type",
    "Priority",
    "Assignees",
    "Labels",
    "Cycle",
    "Modules",
    "Start date",
    "Due date",
    "Estimate",
    "Parent",
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct TaskProperties {
    pub(super) kanleaf_id: Uuid,
    pub(super) reference: String,
    pub(super) title: String,
    pub(super) project: Option<String>,
    pub(super) state: String,
    pub(super) task_type: String,
    pub(super) priority: Option<String>,
    pub(super) assignees: Vec<String>,
    pub(super) labels: Vec<String>,
    pub(super) cycle: Option<String>,
    pub(super) modules: Vec<String>,
    pub(super) start_date: Option<NaiveDate>,
    pub(super) due_date: Option<NaiveDate>,
    pub(super) estimate: Option<i32>,
    pub(super) parent: Option<String>,
}

#[derive(Debug, Error)]
pub(super) enum FrontmatterError {
    #[error("Task Markdown does not contain valid Kanleaf properties")]
    Invalid,
    #[error("Task Markdown belongs to a different Task")]
    IdentityMismatch,
}

pub(super) fn render_new(properties: &TaskProperties, body: &str) -> String {
    let newline = newline_for(body);
    format!(
        "---{newline}{}---{newline}{newline}{body}",
        render_properties(properties, newline)
    )
}

pub(super) fn body(source: &str) -> Result<&str, FrontmatterError> {
    Ok(split(source)?.body)
}

pub(super) fn replace_body(source: &str, body: &str) -> Result<String, FrontmatterError> {
    let split = split(source)?;
    let body_start = source.len() - split.body.len();
    let mut output = String::with_capacity(body_start + body.len());
    output.push_str(&source[..body_start]);
    output.push_str(body);
    Ok(output)
}

pub(super) fn patch(source: &str, properties: &TaskProperties) -> Result<String, FrontmatterError> {
    let split = split(source)?;
    let document = parse_document(split.frontmatter)?;
    let mapping = document.as_mapping().ok_or(FrontmatterError::Invalid)?;
    validate_owned_shapes(mapping)?;
    let current_id = mapping
        .get_node("Kanleaf ID")
        .and_then(Node::as_scalar)
        .and_then(|value| Uuid::parse_str(value.as_str()).ok())
        .ok_or(FrontmatterError::Invalid)?;
    if current_id != properties.kanleaf_id {
        return Err(FrontmatterError::IdentityMismatch);
    }

    let preserved = preserved_custom_source(split.frontmatter, mapping)?;
    let mut patched = String::with_capacity(source.len() + 256);
    patched.push_str(split.opening);
    patched.push_str(&render_properties(properties, split.newline));
    patched.push_str(&preserved);
    patched.push_str(split.closing_and_body);
    Ok(patched)
}

struct SplitDocument<'a> {
    opening: &'a str,
    frontmatter: &'a str,
    closing_and_body: &'a str,
    body: &'a str,
    newline: &'static str,
}

#[derive(Clone, Copy)]
struct Line {
    start: usize,
    content_end: usize,
    end: usize,
}

fn split(source: &str) -> Result<SplitDocument<'_>, FrontmatterError> {
    let lines = lines(source);
    let opening = lines.first().ok_or(FrontmatterError::Invalid)?;
    if line_content(source, *opening) != "---" || opening.end == source.len() {
        return Err(FrontmatterError::Invalid);
    }
    let closing_index = lines
        .iter()
        .enumerate()
        .skip(1)
        .find_map(|(index, line)| (line_content(source, *line) == "---").then_some(index))
        .ok_or(FrontmatterError::Invalid)?;
    let closing = lines[closing_index];
    let body_start = lines
        .get(closing_index + 1)
        .filter(|line| line_content(source, **line).is_empty())
        .map_or(closing.end, |line| line.end);
    let newline = if source[..opening.end].ends_with("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    Ok(SplitDocument {
        opening: &source[..opening.end],
        frontmatter: &source[opening.end..closing.start],
        closing_and_body: &source[closing.start..],
        body: &source[body_start..],
        newline,
    })
}

fn parse_document(frontmatter: &str) -> Result<Node, FrontmatterError> {
    let node = parse_yaml_with_options(
        0,
        frontmatter,
        LoaderOptions::default().error_on_duplicate_keys(true),
    )
    .map_err(|_| FrontmatterError::Invalid)?;
    let mapping = node.as_mapping().ok_or(FrontmatterError::Invalid)?;
    if mapping.keys().any(|key| key.as_str() == "<<") {
        return Err(FrontmatterError::Invalid);
    }
    Ok(node)
}

fn validate_owned_shapes(
    mapping: &marked_yaml::types::MarkedMappingNode,
) -> Result<(), FrontmatterError> {
    for (key, value) in mapping.iter() {
        if key.span().start().is_none_or(|marker| marker.column() != 1) {
            return Err(FrontmatterError::Invalid);
        }
        let valid = match key.as_str() {
            "Kanleaf ID" | "Reference" | "Title" | "Start date" | "Due date" | "Estimate" => {
                value.as_scalar().is_some()
            }
            "Project" | "State" | "Type" | "Priority" | "Assignees" | "Labels" | "Cycle"
            | "Modules" | "Parent" => value
                .as_sequence()
                .is_some_and(|items| items.iter().all(|item| item.as_scalar().is_some())),
            _ => true,
        };
        if !valid {
            return Err(FrontmatterError::Invalid);
        }
    }
    Ok(())
}

fn preserved_custom_source(
    frontmatter: &str,
    mapping: &marked_yaml::types::MarkedMappingNode,
) -> Result<String, FrontmatterError> {
    let source_lines = lines(frontmatter);
    let mut entries = Vec::with_capacity(mapping.len());
    for (key, _) in mapping.iter() {
        let line = key
            .span()
            .start()
            .map(|marker| marker.line())
            .ok_or(FrontmatterError::Invalid)?;
        let start = source_lines
            .get(line.saturating_sub(1))
            .map(|line| line.start)
            .ok_or(FrontmatterError::Invalid)?;
        entries.push((key.as_str(), start));
    }

    let mut preserved = String::new();
    let first_start = entries.first().map_or(frontmatter.len(), |entry| entry.1);
    preserved.push_str(&frontmatter[..first_start]);
    for (index, (key, start)) in entries.iter().enumerate() {
        let end = entries
            .get(index + 1)
            .map_or(frontmatter.len(), |entry| entry.1);
        let block = &frontmatter[*start..end];
        if OWNED_KEYS.contains(key) {
            preserve_comments(block, &mut preserved);
        } else {
            preserved.push_str(block);
        }
    }
    Ok(preserved)
}

fn preserve_comments(block: &str, output: &mut String) {
    for line in lines(block) {
        let content = line_content(block, line).trim();
        if content.is_empty() || content.starts_with('#') {
            output.push_str(&block[line.start..line.end]);
        }
    }
}

fn render_properties(properties: &TaskProperties, newline: &str) -> String {
    let mut output = String::new();
    scalar(
        &mut output,
        "Kanleaf ID",
        &properties.kanleaf_id.to_string(),
        newline,
    );
    scalar(&mut output, "Reference", &properties.reference, newline);
    scalar(&mut output, "Title", &properties.title, newline);
    optional_list(
        &mut output,
        "Project",
        properties.project.as_deref(),
        newline,
    );
    list(&mut output, "State", [&properties.state], newline);
    list(&mut output, "Type", [&properties.task_type], newline);
    optional_list(
        &mut output,
        "Priority",
        properties.priority.as_deref(),
        newline,
    );
    list(&mut output, "Assignees", &properties.assignees, newline);
    list(&mut output, "Labels", &properties.labels, newline);
    optional_list(&mut output, "Cycle", properties.cycle.as_deref(), newline);
    list(&mut output, "Modules", &properties.modules, newline);
    optional_raw_scalar(
        &mut output,
        "Start date",
        properties.start_date.map(|value| value.to_string()),
        newline,
    );
    optional_raw_scalar(
        &mut output,
        "Due date",
        properties.due_date.map(|value| value.to_string()),
        newline,
    );
    optional_raw_scalar(
        &mut output,
        "Estimate",
        properties.estimate.map(|value| value.to_string()),
        newline,
    );
    optional_list(&mut output, "Parent", properties.parent.as_deref(), newline);
    output
}

fn scalar(output: &mut String, key: &str, value: &str, newline: &str) {
    output.push_str(key);
    output.push_str(": ");
    output.push_str(&yaml_string(value));
    output.push_str(newline);
}

fn optional_raw_scalar(output: &mut String, key: &str, value: Option<String>, newline: &str) {
    output.push_str(key);
    output.push(':');
    if let Some(value) = value {
        output.push(' ');
        output.push_str(&value);
    }
    output.push_str(newline);
}

fn optional_list(output: &mut String, key: &str, value: Option<&str>, newline: &str) {
    match value {
        Some(value) => list(output, key, [value], newline),
        None => {
            output.push_str(key);
            output.push_str(": []");
            output.push_str(newline);
        }
    }
}

fn list<I, S>(output: &mut String, key: &str, values: I, newline: &str)
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let values = values.into_iter().collect::<Vec<_>>();
    if values.is_empty() {
        output.push_str(key);
        output.push_str(": []");
        output.push_str(newline);
        return;
    }
    output.push_str(key);
    output.push(':');
    output.push_str(newline);
    for value in values {
        output.push_str("  - ");
        output.push_str(&yaml_string(value.as_ref()));
        output.push_str(newline);
    }
}

fn yaml_string(value: &str) -> String {
    let lowercase = value.to_ascii_lowercase();
    let ambiguous = matches!(
        lowercase.as_str(),
        "null" | "true" | "false" | "yes" | "no" | "on" | "off" | "~"
    ) || value.is_empty()
        || value.trim() != value
        || value.parse::<f64>().is_ok()
        || value.starts_with([
            '-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%',
            '@', '`',
        ])
        || value.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    ':' | '#' | '[' | ']' | '{' | '}' | ',' | '\'' | '"'
                )
        });
    if ambiguous {
        serde_json::Value::String(value.to_owned()).to_string()
    } else {
        value.to_owned()
    }
}

fn newline_for(body: &str) -> &'static str {
    if body.contains("\r\n") { "\r\n" } else { "\n" }
}

fn lines(source: &str) -> Vec<Line> {
    let bytes = source.as_bytes();
    let mut result = Vec::new();
    let mut start = 0;
    while start < bytes.len() {
        let relative_end = bytes[start..].iter().position(|byte| *byte == b'\n');
        let end = relative_end.map_or(bytes.len(), |offset| start + offset + 1);
        let mut content_end = relative_end.map_or(end, |_| end - 1);
        if content_end > start && bytes[content_end - 1] == b'\r' {
            content_end -= 1;
        }
        result.push(Line {
            start,
            content_end,
            end,
        });
        start = end;
    }
    result
}

fn line_content(source: &str, line: Line) -> &str {
    &source[line.start..line.content_end]
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;
    use uuid::Uuid;

    use super::{TaskProperties, body, patch, render_new, replace_body};

    fn properties() -> TaskProperties {
        TaskProperties {
            kanleaf_id: Uuid::parse_str("8a86ccf1-7494-44ea-8fd1-b7c8d9e4f120").unwrap(),
            reference: "KAN-42".to_owned(),
            title: "Implement workspace export".to_owned(),
            project: Some("Kanleaf".to_owned()),
            state: "In Progress".to_owned(),
            task_type: "Task".to_owned(),
            priority: Some("High".to_owned()),
            assignees: vec!["user@example.com".to_owned()],
            labels: vec!["Backend".to_owned()],
            cycle: Some("Sprint 4".to_owned()),
            modules: vec!["Vault".to_owned()],
            start_date: NaiveDate::from_ymd_opt(2026, 8, 30),
            due_date: NaiveDate::from_ymd_opt(2026, 9, 5),
            estimate: Some(3),
            parent: Some("KAN-12".to_owned()),
        }
    }

    #[test]
    fn renders_the_obsidian_property_schema_without_touching_the_body() {
        let source = render_new(
            &properties(),
            "# Export behavior\n\n---\n\n  Preserve spacing.  \n",
        );
        assert_eq!(
            source,
            "---\nKanleaf ID: 8a86ccf1-7494-44ea-8fd1-b7c8d9e4f120\nReference: KAN-42\nTitle: Implement workspace export\nProject:\n  - Kanleaf\nState:\n  - In Progress\nType:\n  - Task\nPriority:\n  - High\nAssignees:\n  - user@example.com\nLabels:\n  - Backend\nCycle:\n  - Sprint 4\nModules:\n  - Vault\nStart date: 2026-08-30\nDue date: 2026-09-05\nEstimate: 3\nParent:\n  - KAN-12\n---\n\n# Export behavior\n\n---\n\n  Preserve spacing.  \n"
        );
        assert_eq!(
            body(&source).unwrap(),
            "# Export behavior\n\n---\n\n  Preserve spacing.  \n"
        );
    }

    #[test]
    fn patches_owned_properties_and_preserves_custom_source_bytes() {
        let source = "---\nKanleaf ID: 8a86ccf1-7494-44ea-8fd1-b7c8d9e4f120\nTitle: Old title\n# keep this comment\nCustom property:\n  nested: \"01\"\n  tags: [one, two]\nState:\n  - Todo\nType:\n  - Task\n---\n\nBody with [[Wiki link]].\n";
        let patched = patch(source, &properties()).unwrap();
        assert!(patched.contains("Title: Implement workspace export\n"));
        assert!(patched.contains("State:\n  - In Progress\n"));
        assert!(patched.contains(
            "# keep this comment\nCustom property:\n  nested: \"01\"\n  tags: [one, two]\n"
        ));
        assert_eq!(body(&patched).unwrap(), "Body with [[Wiki link]].\n");
    }

    #[test]
    fn preserves_crlf_and_quotes_ambiguous_scalars() {
        let mut properties = properties();
        properties.title = "Null: [yes] # literal".to_owned();
        properties.labels = vec!["true".to_owned(), " leading".to_owned()];
        let source = render_new(&properties, "Body\r\nSecond line\r\n");
        assert!(source.contains("Title: \"Null: [yes] # literal\"\r\n"));
        assert!(source.contains("  - \"true\"\r\n  - \" leading\"\r\n"));
        assert_eq!(body(&source).unwrap(), "Body\r\nSecond line\r\n");
        assert!(!source.replace("\r\n", "").contains('\n'));
    }

    #[test]
    fn replaces_only_the_user_body() {
        let source = render_new(&properties(), "old body\n");
        let replaced = replace_body(&source, "new body\n\n---\n").unwrap();
        assert_eq!(body(&replaced).unwrap(), "new body\n\n---\n");
        assert_eq!(
            &replaced[..replaced.len() - "new body\n\n---\n".len()],
            &source[..source.len() - "old body\n".len()]
        );
    }

    #[test]
    fn rejects_yaml_that_cannot_be_patched_safely() {
        let id = "8a86ccf1-7494-44ea-8fd1-b7c8d9e4f120";
        for source in [
            format!("---\nKanleaf ID: {id}\nTitle: one\nTitle: two\n---\nbody"),
            format!("---\nKanleaf ID: {id}\nCustom: &value anchored\nAlias: *value\n---\nbody"),
            format!("---\nKanleaf ID: {id}\n<<: value\n---\nbody"),
            "---\nKanleaf ID: changed\n---\nbody".to_owned(),
            format!("---\nKanleaf ID: {id}\nmissing closing delimiter"),
        ] {
            assert!(patch(&source, &properties()).is_err(), "accepted {source}");
        }
    }
}
