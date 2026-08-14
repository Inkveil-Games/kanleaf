use dioxus::prelude::*;

use crate::task::{Task, create, list_inbox, list_project};

#[component]
pub(super) fn TaskCollection(
    token: String,
    workspace_id: String,
    project_id: Option<String>,
) -> Element {
    let mut tasks = use_signal(Vec::<Task>::new);
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
    let token_for_create = token.clone();
    let workspace_for_create = workspace_id.clone();
    let project_for_create = project_id.clone();

    rsx! {
        div { class: "task-collection",
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
                                        tasks.write().push(task);
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
                        div { class: "task-row", key: "{task.id}",
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

            if let Some(message) = error.read().clone() {
                p { class: "task-list-error", role: "alert", "{message}" }
            }
        }
    }
}
