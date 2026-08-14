mod api;

use dioxus::prelude::*;

pub use api::logout;
use api::{email_exists, login, register, request_password_reset};

#[derive(Clone, PartialEq)]
enum AuthStep {
    Email,
    Login { email: String },
    Register { email: String },
    ForgotPassword { email: String },
}

#[component]
pub fn AuthFlow(on_authenticated: EventHandler<String>) -> Element {
    let mut step = use_signal(|| AuthStep::Email);
    let mut email = use_signal(String::new);
    let mut password = use_signal(String::new);
    let mut password_confirmation = use_signal(String::new);
    let mut error = use_signal(|| None::<String>);
    let mut notice = use_signal(|| None::<String>);
    let mut loading = use_signal(|| false);

    let current_step = step.read().clone();
    let error_message = error.read().clone();
    let notice_message = notice.read().clone();
    let is_loading = *loading.read();

    let form = match current_step {
        AuthStep::Email => rsx! {
            div { class: "step-heading",
                p { class: "eyebrow", "Welcome to Kanleaf" }
                h1 { "Continue with email" }
                p { class: "step-copy", "Use your work email to sign in or create a local account." }
            }

            form {
                class: "auth-form",
                onsubmit: move |event| async move {
                    event.prevent_default();
                    error.set(None);
                    notice.set(None);

                    let submitted_email = email.read().trim().to_owned();
                    if submitted_email.is_empty() {
                        error.set(Some("Enter your email address.".to_owned()));
                        return;
                    }

                    loading.set(true);
                    let result = email_exists(&submitted_email).await;
                    loading.set(false);

                    match result {
                        Ok(true) => {
                            email.set(submitted_email.clone());
                            step.set(AuthStep::Login {
                                email: submitted_email,
                            });
                        }
                        Ok(false) => {
                            email.set(submitted_email.clone());
                            step.set(AuthStep::Register {
                                email: submitted_email,
                            });
                        }
                        Err(message) => error.set(Some(message)),
                    }
                },
                label { r#for: "email", "Email" }
                input {
                    id: "email",
                    r#type: "email",
                    autocomplete: "email",
                    autofocus: true,
                    placeholder: "you@example.com",
                    value: email,
                    oninput: move |event| {
                        email.set(event.value());
                        error.set(None);
                    }
                }
                Feedback {
                    error: error_message.clone(),
                    notice: notice_message.clone(),
                }
                button {
                    class: "primary-button",
                    r#type: "submit",
                    disabled: is_loading,
                    if is_loading { "Checking…" } else { "Continue" }
                }
            }
        },
        AuthStep::Login {
            email: account_email,
        } => {
            let email_for_submit = account_email.clone();
            let email_for_forgot = account_email.clone();

            rsx! {
                div { class: "step-heading",
                    p { class: "eyebrow", "Welcome back" }
                    h1 { "Enter your password" }
                    p { class: "step-copy", "Sign in to continue to your workspace." }
                }

                AccountChip {
                    email: account_email,
                    onchange: move |_| {
                        password.set(String::new());
                        error.set(None);
                        step.set(AuthStep::Email);
                    },
                }

                form {
                    class: "auth-form",
                    onsubmit: move |event| {
                        let account_email = email_for_submit.clone();
                        async move {
                            event.prevent_default();
                            error.set(None);
                            notice.set(None);
                            let submitted_password = password.read().clone();

                            if submitted_password.is_empty() {
                                error.set(Some("Enter your password.".to_owned()));
                                return;
                            }

                            loading.set(true);
                            let result = login(&account_email, &submitted_password).await;
                            loading.set(false);

                            match result {
                                Ok(token) => {
                                    password.set(String::new());
                                    on_authenticated.call(token);
                                }
                                Err(message) => error.set(Some(message)),
                            }
                        }
                    },
                    div { class: "label-row",
                        label { r#for: "password", "Password" }
                        button {
                            class: "text-button",
                            r#type: "button",
                            onclick: move |_| {
                                error.set(None);
                                notice.set(None);
                                step.set(AuthStep::ForgotPassword {
                                    email: email_for_forgot.clone(),
                                });
                            },
                            "Forgot password?"
                        }
                    }
                    input {
                        id: "password",
                        r#type: "password",
                        autocomplete: "current-password",
                        autofocus: true,
                        placeholder: "Enter your password",
                        value: password,
                        oninput: move |event| {
                            password.set(event.value());
                            error.set(None);
                        }
                    }
                    Feedback {
                        error: error_message.clone(),
                        notice: notice_message.clone(),
                    }
                    button {
                        class: "primary-button",
                        r#type: "submit",
                        disabled: is_loading,
                        if is_loading { "Signing in…" } else { "Sign in" }
                    }
                }
            }
        }
        AuthStep::Register {
            email: account_email,
        } => {
            let email_for_submit = account_email.clone();

            rsx! {
                div { class: "step-heading",
                    p { class: "eyebrow", "New account" }
                    h1 { "Create your password" }
                    p { class: "step-copy", "Keep it memorable and at least 8 characters long." }
                }

                AccountChip {
                    email: account_email,
                    onchange: move |_| {
                        password.set(String::new());
                        password_confirmation.set(String::new());
                        error.set(None);
                        step.set(AuthStep::Email);
                    },
                }

                form {
                    class: "auth-form",
                    onsubmit: move |event| {
                        let account_email = email_for_submit.clone();
                        async move {
                            event.prevent_default();
                            error.set(None);
                            notice.set(None);
                            let submitted_password = password.read().clone();
                            let submitted_confirmation = password_confirmation.read().clone();

                            if submitted_password.len() < 8 {
                                error.set(Some(
                                    "Password must be at least 8 characters.".to_owned(),
                                ));
                                return;
                            }

                            if submitted_password != submitted_confirmation {
                                error.set(Some("The passwords do not match.".to_owned()));
                                return;
                            }

                            loading.set(true);
                            let result = register(
                                &account_email,
                                &submitted_password,
                                &submitted_confirmation,
                            )
                            .await;
                            loading.set(false);

                            match result {
                                Ok(token) => {
                                    password.set(String::new());
                                    password_confirmation.set(String::new());
                                    on_authenticated.call(token);
                                }
                                Err(message) => error.set(Some(message)),
                            }
                        }
                    },
                    label { r#for: "new-password", "Password" }
                    input {
                        id: "new-password",
                        r#type: "password",
                        autocomplete: "new-password",
                        autofocus: true,
                        minlength: 8,
                        placeholder: "At least 8 characters",
                        value: password,
                        oninput: move |event| {
                            password.set(event.value());
                            error.set(None);
                        }
                    }
                    label { r#for: "confirm-password", "Confirm password" }
                    input {
                        id: "confirm-password",
                        r#type: "password",
                        autocomplete: "new-password",
                        minlength: 8,
                        placeholder: "Enter it once more",
                        value: password_confirmation,
                        oninput: move |event| {
                            password_confirmation.set(event.value());
                            error.set(None);
                        }
                    }
                    Feedback {
                        error: error_message.clone(),
                        notice: notice_message.clone(),
                    }
                    button {
                        class: "primary-button",
                        r#type: "submit",
                        disabled: is_loading,
                        if is_loading { "Creating account…" } else { "Create account" }
                    }
                }
            }
        }
        AuthStep::ForgotPassword {
            email: account_email,
        } => {
            let email_for_submit = account_email.clone();
            let email_for_back = account_email.clone();

            rsx! {
                div { class: "step-heading",
                    p { class: "eyebrow", "Account recovery" }
                    h1 { "Reset your password" }
                    p { class: "step-copy", "Password recovery is limited while accounts are stored locally." }
                }

                AccountChip { email: account_email }

                div { class: "auth-form",
                    Feedback {
                        error: error_message.clone(),
                        notice: notice_message.clone(),
                    }
                    button {
                        class: "primary-button",
                        r#type: "button",
                        disabled: is_loading,
                        onclick: move |_| {
                            let account_email = email_for_submit.clone();
                            async move {
                                error.set(None);
                                notice.set(None);
                                loading.set(true);
                                let result = request_password_reset(&account_email).await;
                                loading.set(false);

                                match result {
                                    Ok(message) => notice.set(Some(message)),
                                    Err(message) => error.set(Some(message)),
                                }
                            }
                        },
                        if is_loading { "Requesting…" } else { "Request password reset" }
                    }
                    button {
                        class: "secondary-button",
                        r#type: "button",
                        onclick: move |_| {
                            error.set(None);
                            notice.set(None);
                            step.set(AuthStep::Login {
                                email: email_for_back.clone(),
                            });
                        },
                        "Back to sign in"
                    }
                }
            }
        }
    };

    rsx! {
        main { class: "auth-page",
            div { class: "wordmark",
                span { class: "wordmark-mark", "K" }
                span { "Kanleaf" }
            }
            section { class: "auth-container",
                article { class: "auth-card", {form} }
            }
        }
    }
}

#[component]
fn AccountChip(email: String, onchange: Option<EventHandler<MouseEvent>>) -> Element {
    rsx! {
        div { class: "account-chip",
            span { class: "account-avatar", "@" }
            span { class: "account-email", "{email}" }
            if let Some(onchange) = onchange {
                button {
                    class: "change-email",
                    r#type: "button",
                    onclick: move |event| onchange.call(event),
                    "Change"
                }
            }
        }
    }
}

#[component]
fn Feedback(error: Option<String>, notice: Option<String>) -> Element {
    rsx! {
        if let Some(message) = error {
            p { class: "form-message error", role: "alert", "{message}" }
        }
        if let Some(message) = notice {
            p { class: "form-message notice", role: "status", "{message}" }
        }
    }
}
