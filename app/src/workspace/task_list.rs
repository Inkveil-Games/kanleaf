use dioxus::prelude::*;

use crate::{
    project::Project,
    task::{
        Task, TaskStatus, create, get_content, list_inbox, list_project, update_content,
        update_project, update_status, update_title,
    },
};

#[component]
pub(super) fn TaskCollection(
    token: String,
    workspace_id: String,
    project_id: Option<String>,
    projects: Vec<Project>,
) -> Element {
    let mut tasks = use_signal(Vec::<Task>::new);
    let mut selected_task = use_signal(|| None::<Task>);
    let mut loading = use_signal(|| true);
    let mut error = use_signal(|| None::<String>);
    let mut creating = use_signal(|| false);
    let mut title = use_signal(String::new);

    let token_for_load = token.clone();
    let workspace_for_load = workspace_id.clone();
    let project_for_load = project_id.clone();
    use_future(move || {
        let token = token_for_load.clone();
        let workspace_id = workspace_for_load.clone();
        let project_id = project_for_load.clone();
        async move {
            let result = if let Some(project_id) = project_id {
                list_project(&token, &workspace_id, &project_id).await
            } else {
                list_inbox(&token, &workspace_id).await
            };
            match result {
                Ok(response) => tasks.set(response),
                Err(message) => error.set(Some(message)),
            }
            loading.set(false);
        }
    });

    let task_items = tasks.read().clone();
    let selected = selected_task.read().clone();
    let token_for_create = token.clone();
    let workspace_for_create = workspace_id.clone();
    let project_for_create = project_id.clone();
    let scope_project_id = project_id.clone();

    rsx! {
        div { class: "task-workspace",
            div { class: "task-collection-pane",
                div { class: "task-collection-toolbar",
                    if *creating.read() {
                        form {
                            class: "task-create-form",
                            onsubmit: move |event| {
                                let token = token_for_create.clone();
                                let workspace_id = workspace_for_create.clone();
                                let project_id = project_for_create.clone();
                                async move {
                                    event.prevent_default();
                                    let task_title = title.read().trim().to_owned();
                                    if task_title.is_empty() {
                                        error.set(Some("Enter a task title.".to_owned()));
                                        return;
                                    }

                                    match create(
                                        &token,
                                        &workspace_id,
                                        project_id.as_deref(),
                                        &task_title,
                                    )
                                    .await
                                    {
                                        Ok(task) => {
                                            tasks.write().push(task.clone());
                                            selected_task.set(Some(task));
                                            title.set(String::new());
                                            error.set(None);
                                            creating.set(false);
                                        }
                                        Err(message) => error.set(Some(message)),
                                    }
                                }
                            },
                            input {
                                r#type: "text",
                                aria_label: "Task title",
                                autofocus: true,
                                placeholder: "Task title",
                                value: title,
                                oninput: move |event| title.set(event.value()),
                            }
                            button { r#type: "submit", "Add" }
                            button {
                                class: "task-create-cancel",
                                r#type: "button",
                                onclick: move |_| {
                                    title.set(String::new());
                                    creating.set(false);
                                },
                                "Cancel"
                            }
                        }
                    } else {
                        button {
                            class: "task-add-action",
                            r#type: "button",
                            onclick: move |_| creating.set(true),
                            span { aria_hidden: "true", "+" }
                            "Add task"
                        }
                    }
                }

                if *loading.read() {
                    p { class: "task-list-message", "Loading tasks…" }
                } else if task_items.is_empty() {
                    p { class: "task-list-message", "No tasks here yet." }
                } else {
                    div { class: "task-list",
                        for task in task_items {
                            {
                                let is_selected = selected
                                    .as_ref()
                                    .is_some_and(|selected| selected.id == task.id);
                                let task_for_select = task.clone();
                                rsx! {
                                    button {
                                        class: if is_selected { "task-row selected" } else { "task-row" },
                                        key: "{task.id}",
                                        r#type: "button",
                                        aria_pressed: is_selected,
                                        onclick: move |_| selected_task.set(Some(task_for_select.clone())),
                                        span {
                                            class: "task-status-mark {task.status.class_name()}",
                                            aria_hidden: "true",
                                        }
                                        span { class: "task-row-title", "{task.title}" }
                                        span { class: "task-row-status", "{task.status.label()}" }
                                    }
                                }
                            }
                        }
                    }
                }

                if let Some(message) = error.read().clone() {
                    p { class: "task-list-error", role: "alert", "{message}" }
                }
            }

            if let Some(task) = selected {
                TaskDetail {
                    key: "{task.id}",
                    token,
                    workspace_id,
                    task,
                    projects,
                    on_updated: move |updated: Task| {
                        if task_belongs_to_scope(&updated, &scope_project_id) {
                            if let Some(existing) = tasks
                                .write()
                                .iter_mut()
                                .find(|task| task.id == updated.id)
                            {
                                *existing = updated.clone();
                            }
                        } else {
                            tasks.write().retain(|task| task.id != updated.id);
                        }
                        selected_task.set(Some(updated));
                    },
                }
            } else {
                div { class: "task-detail-empty",
                    p { "Select a task to open it." }
                }
            }
        }
    }
}

fn task_belongs_to_scope(task: &Task, project_id: &Option<String>) -> bool {
    &task.project_id == project_id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moving_a_task_changes_which_collection_contains_it() {
        let mut task = Task {
            id: "task-a".to_owned(),
            workspace_id: "workspace-a".to_owned(),
            project_id: None,
            title: "Task A".to_owned(),
            status: TaskStatus::Todo,
        };

        assert!(task_belongs_to_scope(&task, &None));
        assert!(!task_belongs_to_scope(&task, &Some("project-a".to_owned())));

        task.project_id = Some("project-a".to_owned());

        assert!(!task_belongs_to_scope(&task, &None));
        assert!(task_belongs_to_scope(&task, &Some("project-a".to_owned())));
        assert!(!task_belongs_to_scope(&task, &Some("project-b".to_owned())));
    }

    #[test]
    fn save_shortcut_accepts_control_and_command() {
        let key = Key::Character("s".to_owned());

        assert!(is_save_shortcut(&key, Modifiers::CONTROL));
        assert!(is_save_shortcut(&key, Modifiers::META));
        assert!(!is_save_shortcut(&key, Modifiers::SHIFT));
        assert!(!is_save_shortcut(
            &Key::Character("x".to_owned()),
            Modifiers::CONTROL
        ));
    }
}

#[component]
fn TaskDetail(
    token: String,
    workspace_id: String,
    task: Task,
    projects: Vec<Project>,
    on_updated: EventHandler<Task>,
) -> Element {
    let mut title = use_signal(|| task.title.clone());
    let mut saving = use_signal(|| false);
    let mut error = use_signal(|| None::<String>);
    let mut markdown = use_signal(String::new);
    let mut saved_markdown = use_signal(String::new);
    let mut content_loading = use_signal(|| true);
    let content_saving = use_signal(|| false);
    let mut content_error = use_signal(|| None::<String>);

    let token_for_content_load = token.clone();
    let workspace_for_content_load = workspace_id.clone();
    let task_for_content_load = task.id.clone();
    use_future(move || {
        let token = token_for_content_load.clone();
        let workspace_id = workspace_for_content_load.clone();
        let task_id = task_for_content_load.clone();
        async move {
            match get_content(&token, &workspace_id, &task_id).await {
                Ok(content) => {
                    markdown.set(content.clone());
                    saved_markdown.set(content);
                    content_error.set(None);
                }
                Err(message) => content_error.set(Some(message)),
            }
            content_loading.set(false);
        }
    });

    let title_updated = on_updated;
    let status_updated = on_updated;
    let project_updated = on_updated;
    let token_for_title = token.clone();
    let workspace_for_title = workspace_id.clone();
    let task_for_title = task.id.clone();
    let token_for_status = token.clone();
    let workspace_for_status = workspace_id.clone();
    let task_for_status = task.id.clone();
    let token_for_project = token.clone();
    let workspace_for_project = workspace_id.clone();
    let task_for_project = task.id.clone();
    let token_for_content_save = token.clone();
    let workspace_for_content_save = workspace_id.clone();
    let task_for_content_save = task.id.clone();
    let token_for_shortcut = token;
    let workspace_for_shortcut = workspace_id;
    let task_for_shortcut = task.id.clone();
    let has_unsaved_content = *markdown.read() != *saved_markdown.read();

    rsx! {
        article { class: "task-detail",
            form {
                class: "task-title-form",
                onsubmit: move |event| {
                    let token = token_for_title.clone();
                    let workspace_id = workspace_for_title.clone();
                    let task_id = task_for_title.clone();
                    async move {
                        event.prevent_default();
                        let next_title = title.read().trim().to_owned();
                        if next_title.is_empty() {
                            error.set(Some("Enter a task title.".to_owned()));
                            return;
                        }

                        saving.set(true);
                        match update_title(&token, &workspace_id, &task_id, &next_title).await {
                            Ok(updated) => {
                                title.set(updated.title.clone());
                                error.set(None);
                                title_updated.call(updated);
                            }
                            Err(message) => error.set(Some(message)),
                        }
                        saving.set(false);
                    }
                },
                input {
                    class: "task-title-input",
                    r#type: "text",
                    aria_label: "Task title",
                    value: title,
                    disabled: *saving.read(),
                    oninput: move |event| title.set(event.value()),
                }
                button { r#type: "submit", disabled: *saving.read(), "Save" }
            }

            dl { class: "task-fields",
                div {
                    dt { "Status" }
                    dd {
                        select {
                            aria_label: "Task status",
                            value: task.status.as_str(),
                            disabled: *saving.read(),
                            onchange: move |event| {
                                let status = TaskStatus::from_value(&event.value());
                                let token = token_for_status.clone();
                                let workspace_id = workspace_for_status.clone();
                                let task_id = task_for_status.clone();
                                async move {
                                    let Some(status) = status else {
                                        return;
                                    };
                                    saving.set(true);
                                    match update_status(&token, &workspace_id, &task_id, status).await {
                                        Ok(updated) => {
                                            error.set(None);
                                            status_updated.call(updated);
                                        }
                                        Err(message) => error.set(Some(message)),
                                    }
                                    saving.set(false);
                                }
                            },
                            option { value: "todo", "Todo" }
                            option { value: "in_progress", "In Progress" }
                            option { value: "done", "Done" }
                        }
                    }
                }
                div {
                    dt { "Project" }
                    dd {
                        select {
                            aria_label: "Task project",
                            value: task.project_id.clone().unwrap_or_default(),
                            disabled: *saving.read(),
                            onchange: move |event| {
                                let value = event.value();
                                let project_id = (!value.is_empty()).then_some(value);
                                let token = token_for_project.clone();
                                let workspace_id = workspace_for_project.clone();
                                let task_id = task_for_project.clone();
                                async move {
                                    saving.set(true);
                                    match update_project(
                                        &token,
                                        &workspace_id,
                                        &task_id,
                                        project_id.as_deref(),
                                    )
                                    .await
                                    {
                                        Ok(updated) => {
                                            error.set(None);
                                            project_updated.call(updated);
                                        }
                                        Err(message) => error.set(Some(message)),
                                    }
                                    saving.set(false);
                                }
                            },
                            option { value: "", "Inbox / No project" }
                            for project in projects {
                                option { value: "{project.id}", "{project.name}" }
                            }
                        }
                    }
                }
            }

            form {
                class: "task-document-editor",
                onsubmit: move |event| {
                    event.prevent_default();
                    let token = token_for_content_save.clone();
                    let workspace_id = workspace_for_content_save.clone();
                    let task_id = task_for_content_save.clone();
                    let content = markdown.read().clone();
                    async move {
                        save_markdown(
                            token,
                            workspace_id,
                            task_id,
                            content,
                            saved_markdown,
                            content_saving,
                            content_error,
                        )
                        .await;
                    }
                },
                div { class: "task-document-toolbar",
                    span { class: "task-document-label", "Markdown" }
                    span {
                        class: if has_unsaved_content { "task-document-state unsaved" } else { "task-document-state" },
                        if *content_loading.read() {
                            "Loading…"
                        } else if *content_saving.read() {
                            "Saving…"
                        } else if has_unsaved_content {
                            "Unsaved"
                        } else {
                            "Saved"
                        }
                    }
                    button {
                        r#type: "submit",
                        disabled: *content_loading.read()
                            || *content_saving.read()
                            || !has_unsaved_content,
                        "Save"
                    }
                }
                textarea {
                    class: "task-markdown-editor",
                    aria_label: "Task Markdown content",
                    placeholder: "Write Markdown…",
                    disabled: *content_loading.read(),
                    value: markdown,
                    oninput: move |event| markdown.set(event.value()),
                    onkeydown: move |event| {
                        if !is_save_shortcut(&event.key(), event.modifiers()) {
                            return;
                        }
                        event.prevent_default();
                        let token = token_for_shortcut.clone();
                        let workspace_id = workspace_for_shortcut.clone();
                        let task_id = task_for_shortcut.clone();
                        let content = markdown.read().clone();
                        spawn(async move {
                            save_markdown(
                                token,
                                workspace_id,
                                task_id,
                                content,
                                saved_markdown,
                                content_saving,
                                content_error,
                            )
                            .await;
                        });
                    },
                }
                if let Some(message) = content_error.read().clone() {
                    p { class: "task-document-error", role: "alert", "{message}" }
                }
            }

            if let Some(message) = error.read().clone() {
                p { class: "task-detail-error", role: "alert", "{message}" }
            }
        }
    }
}

async fn save_markdown(
    token: String,
    workspace_id: String,
    task_id: String,
    content: String,
    mut saved_markdown: Signal<String>,
    mut saving: Signal<bool>,
    mut error: Signal<Option<String>>,
) {
    if *saving.read() {
        return;
    }

    saving.set(true);
    match update_content(&token, &workspace_id, &task_id, &content).await {
        Ok(saved) => {
            saved_markdown.set(saved);
            error.set(None);
        }
        Err(message) => error.set(Some(message)),
    }
    saving.set(false);
}

fn is_save_shortcut(key: &Key, modifiers: Modifiers) -> bool {
    matches!(key, Key::Character(value) if value.eq_ignore_ascii_case("s"))
        && (modifiers.contains(Modifiers::CONTROL) || modifiers.contains(Modifiers::META))
}
