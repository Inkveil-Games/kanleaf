use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use chrono::{DateTime, Utc};
use lettre::{
    Address, AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{Mailbox, MultiPart},
    transport::smtp::authentication::Credentials,
};
use serde::Serialize;
use thiserror::Error;
use url::Url;

use crate::config::{MailConfig, SmtpConfig, SmtpSecurity};

const SMTP_TIMEOUT: Duration = Duration::from_secs(10);

pub type MailFuture<'a> = Pin<Box<dyn Future<Output = Result<(), MailTransportError>> + Send + 'a>>;

pub trait MailTransport: Send + Sync {
    fn send(&self, message: MailMessage) -> MailFuture<'_>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MailMessage {
    pub from_name: String,
    pub from_email: String,
    pub to_email: String,
    pub subject: String,
    pub text_body: String,
    pub html_body: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MailTransportError;

#[derive(Debug, Error)]
pub enum MailSetupError {
    #[error("SMTP transport could not be configured")]
    Transport,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MailDelivery {
    Sent,
    Failed,
    Disabled,
}

#[derive(Clone)]
pub struct Mailer {
    public_url: Option<Url>,
    sender: Option<MailSender>,
    transport: Option<Arc<dyn MailTransport>>,
    delivery_timeout: Duration,
}

#[derive(Clone)]
struct MailSender {
    name: String,
    email: String,
}

pub struct WorkspaceInvitationMail<'a> {
    pub invitee_email: &'a str,
    pub inviter_display_name: &'a str,
    pub workspace_name: &'a str,
    pub role: &'a str,
    pub expires_at: DateTime<Utc>,
    pub token: &'a str,
}

impl Mailer {
    pub fn disabled() -> Self {
        Self {
            public_url: None,
            sender: None,
            transport: None,
            delivery_timeout: SMTP_TIMEOUT,
        }
    }

    pub fn from_config(config: MailConfig) -> Result<Self, MailSetupError> {
        let Some(smtp) = config.smtp else {
            return Ok(Self {
                public_url: config.public_url,
                sender: None,
                transport: None,
                delivery_timeout: SMTP_TIMEOUT,
            });
        };
        let public_url = config.public_url.ok_or(MailSetupError::Transport)?;
        let sender = MailSender {
            name: smtp.from_name.clone(),
            email: smtp.from_email.clone(),
        };
        let transport = Arc::new(SmtpMailTransport::new(smtp)?);
        Ok(Self {
            public_url: Some(public_url),
            sender: Some(sender),
            transport: Some(transport),
            delivery_timeout: SMTP_TIMEOUT,
        })
    }

    pub fn with_transport(
        public_url: Url,
        from_name: impl Into<String>,
        from_email: impl Into<String>,
        transport: Arc<dyn MailTransport>,
    ) -> Self {
        Self {
            public_url: Some(public_url),
            sender: Some(MailSender {
                name: from_name.into(),
                email: from_email.into(),
            }),
            transport: Some(transport),
            delivery_timeout: SMTP_TIMEOUT,
        }
    }

    #[cfg(test)]
    fn with_delivery_timeout(mut self, timeout: Duration) -> Self {
        self.delivery_timeout = timeout;
        self
    }

    pub fn invitation_url(&self, token: &str) -> Option<Url> {
        let mut url = self.public_url.clone()?.join("invite").ok()?;
        url.set_fragment(Some(&format!("token={token}")));
        Some(url)
    }

    pub async fn send_workspace_invitation(
        &self,
        invitation: WorkspaceInvitationMail<'_>,
    ) -> MailDelivery {
        let (Some(sender), Some(transport), Some(invitation_url)) = (
            self.sender.as_ref(),
            self.transport.as_ref(),
            self.invitation_url(invitation.token),
        ) else {
            return MailDelivery::Disabled;
        };
        let message = workspace_invitation_message(sender, invitation, &invitation_url);
        match tokio::time::timeout(self.delivery_timeout, transport.send(message)).await {
            Ok(Ok(())) => MailDelivery::Sent,
            Ok(Err(_)) | Err(_) => MailDelivery::Failed,
        }
    }
}

struct SmtpMailTransport {
    transport: AsyncSmtpTransport<Tokio1Executor>,
}

impl SmtpMailTransport {
    fn new(config: SmtpConfig) -> Result<Self, MailSetupError> {
        let builder = match config.security {
            SmtpSecurity::StartTls => {
                AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
                    .map_err(|_| MailSetupError::Transport)?
            }
            SmtpSecurity::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)
                .map_err(|_| MailSetupError::Transport)?,
            SmtpSecurity::None => {
                AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
            }
        };
        let builder = builder.port(config.port).timeout(Some(SMTP_TIMEOUT));
        let builder = match config.credentials {
            Some(credentials) => {
                builder.credentials(Credentials::new(credentials.username, credentials.password))
            }
            None => builder,
        };
        Ok(Self {
            transport: builder.build(),
        })
    }
}

impl MailTransport for SmtpMailTransport {
    fn send(&self, message: MailMessage) -> MailFuture<'_> {
        Box::pin(async move {
            let email = lettre_message(&message)?;
            self.transport
                .send(email)
                .await
                .map(|_| ())
                .map_err(|_| MailTransportError)
        })
    }
}

fn lettre_message(message: &MailMessage) -> Result<Message, MailTransportError> {
    let from = Mailbox::new(
        Some(message.from_name.clone()),
        message
            .from_email
            .parse::<Address>()
            .map_err(|_| MailTransportError)?,
    );
    let to = Mailbox::new(
        None,
        message
            .to_email
            .parse::<Address>()
            .map_err(|_| MailTransportError)?,
    );
    Message::builder()
        .from(from)
        .to(to)
        .subject(&message.subject)
        .multipart(MultiPart::alternative_plain_html(
            message.text_body.clone(),
            message.html_body.clone(),
        ))
        .map_err(|_| MailTransportError)
}

fn workspace_invitation_message(
    sender: &MailSender,
    invitation: WorkspaceInvitationMail<'_>,
    invitation_url: &Url,
) -> MailMessage {
    let role = role_label(invitation.role);
    let expires = invitation.expires_at.format("%B %-d, %Y at %H:%M UTC");
    let subject = format!(
        "{} invited you to {} on Kanleaf",
        header_text(invitation.inviter_display_name),
        header_text(invitation.workspace_name)
    );
    let text_body = format!(
        "{} invited you to join {} on Kanleaf.\n\nRole: {}\nExpires: {}\n\nView invitation:\n{}\n",
        invitation.inviter_display_name, invitation.workspace_name, role, expires, invitation_url
    );
    let html_body = format!(
        concat!(
            "<!doctype html><html><body style=\"font-family:system-ui,sans-serif;color:#1f2933\">",
            "<p><strong>{}</strong> invited you to join <strong>{}</strong> on Kanleaf.</p>",
            "<p>Role: {}<br>Expires: {}</p>",
            "<p><a href=\"{}\">View invitation</a></p>",
            "</body></html>"
        ),
        escape_html(invitation.inviter_display_name),
        escape_html(invitation.workspace_name),
        escape_html(role),
        escape_html(&expires.to_string()),
        escape_html(invitation_url.as_str())
    );
    MailMessage {
        from_name: sender.name.clone(),
        from_email: sender.email.clone(),
        to_email: invitation.invitee_email.to_owned(),
        subject,
        text_body,
        html_body,
    }
}

fn header_text(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect()
}

fn role_label(role: &str) -> &'static str {
    match role {
        "admin" => "Admin",
        "guest" => "Guest",
        _ => "Member",
    }
}

fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use std::{
        future::pending,
        sync::{Arc, Mutex},
        time::Duration,
    };

    use chrono::{TimeZone, Utc};
    use sha2::{Digest, Sha256};
    use url::Url;

    use super::{
        MailDelivery, MailFuture, MailMessage, MailTransport, MailTransportError, Mailer,
        WorkspaceInvitationMail, lettre_message,
    };

    #[derive(Default)]
    struct CapturingTransport {
        messages: Mutex<Vec<MailMessage>>,
    }

    impl MailTransport for CapturingTransport {
        fn send(&self, message: MailMessage) -> MailFuture<'_> {
            self.messages.lock().unwrap().push(message);
            Box::pin(async { Ok(()) })
        }
    }

    #[derive(Default)]
    struct FailingTransport;

    impl MailTransport for FailingTransport {
        fn send(&self, _message: MailMessage) -> MailFuture<'_> {
            Box::pin(async { Err(MailTransportError) })
        }
    }

    struct PendingTransport;

    impl MailTransport for PendingTransport {
        fn send(&self, _message: MailMessage) -> MailFuture<'_> {
            Box::pin(pending())
        }
    }

    #[tokio::test]
    async fn renders_and_sends_a_safe_multipart_invitation() {
        let transport = Arc::new(CapturingTransport::default());
        let mailer = Mailer::with_transport(
            Url::parse("https://tasks.example.com/base/../").unwrap(),
            "Kanleaf Team",
            "notifications@example.com",
            transport.clone(),
        );
        let token = "raw-invitation-token";
        let delivery = mailer
            .send_workspace_invitation(WorkspaceInvitationMail {
                invitee_email: "alice@example.com",
                inviter_display_name: "Quang <script>",
                workspace_name: "Inkveil & Games",
                role: "member",
                expires_at: Utc.with_ymd_and_hms(2026, 9, 16, 12, 30, 0).unwrap(),
                token,
            })
            .await;

        assert_eq!(delivery, MailDelivery::Sent);
        let messages = transport.messages.lock().unwrap();
        assert_eq!(messages.len(), 1);
        let message = &messages[0];
        assert_eq!(message.from_name, "Kanleaf Team");
        assert_eq!(message.from_email, "notifications@example.com");
        assert_eq!(message.to_email, "alice@example.com");
        assert!(message.subject.contains("Quang <script>"));
        assert!(message.subject.contains("Inkveil & Games"));
        assert!(message.text_body.contains("Role: Member"));
        assert!(
            message
                .text_body
                .contains("September 16, 2026 at 12:30 UTC")
        );
        assert!(
            message
                .text_body
                .contains("https://tasks.example.com/invite#token=raw-invitation-token")
        );
        assert!(message.html_body.contains("Quang &lt;script&gt;"));
        assert!(message.html_body.contains("Inkveil &amp; Games"));
        assert!(
            message
                .html_body
                .contains("https://tasks.example.com/invite#token=raw-invitation-token")
        );
        assert!(!message.html_body.contains("Quang <script>"));
        let token_hash = format!("{:x}", Sha256::digest(token.as_bytes()));
        assert!(!message.text_body.contains(&token_hash));
        assert!(!message.html_body.contains(&token_hash));

        let wire = lettre_message(message).unwrap().formatted();
        let wire = String::from_utf8(wire).unwrap();
        assert!(wire.contains("Kanleaf Team"));
        assert!(wire.contains("notifications@example.com"));
        assert!(wire.contains("To: alice@example.com"));
        assert!(wire.contains("multipart/alternative"));
        assert!(wire.contains("text/plain"));
        assert!(wire.contains("text/html"));
    }

    #[tokio::test]
    async fn distinguishes_disabled_and_failed_delivery() {
        let invitation = || WorkspaceInvitationMail {
            invitee_email: "alice@example.com",
            inviter_display_name: "Quang",
            workspace_name: "Inkveil Games",
            role: "admin",
            expires_at: Utc::now(),
            token: "raw-token",
        };
        assert_eq!(
            Mailer::disabled()
                .send_workspace_invitation(invitation())
                .await,
            MailDelivery::Disabled
        );
        let failing = Mailer::with_transport(
            Url::parse("https://tasks.example.com").unwrap(),
            "Kanleaf",
            "notifications@example.com",
            Arc::new(FailingTransport),
        );
        assert_eq!(
            failing.send_workspace_invitation(invitation()).await,
            MailDelivery::Failed
        );

        let timing_out = Mailer::with_transport(
            Url::parse("https://tasks.example.com").unwrap(),
            "Kanleaf",
            "notifications@example.com",
            Arc::new(PendingTransport),
        )
        .with_delivery_timeout(Duration::from_millis(1));
        assert_eq!(
            timing_out.send_workspace_invitation(invitation()).await,
            MailDelivery::Failed
        );
    }
}
