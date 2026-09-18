use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use ring::hmac;
use sha2::{Digest, Sha256};
use uuid::Uuid;

// Deliberately has no Debug or Serialize implementation.
#[derive(Clone)]
pub struct SigningKey(hmac::Key, String);

impl SigningKey {
    pub fn parse(value: &str) -> Result<Self, &'static str> {
        let bytes = STANDARD
            .decode(value.trim())
            .map_err(|_| "Webhook signing key must be base64 encoding exactly 32 bytes")?;
        if bytes.len() != 32 {
            return Err("Webhook signing key must be base64 encoding exactly 32 bytes");
        }
        Ok(Self(
            hmac::Key::new(hmac::HMAC_SHA256, &bytes),
            URL_SAFE_NO_PAD.encode(Sha256::digest(&bytes)),
        ))
    }

    pub(crate) fn id(&self) -> &str {
        &self.1
    }

    pub(crate) fn derive(&self, workspace: Uuid, webhook: Uuid, nonce: &[u8]) -> String {
        let mut context = hmac::Context::with_key(&self.0);
        context.update(b"kanleaf.webhook.signing-secret.v1\0");
        context.update(workspace.as_bytes());
        context.update(webhook.as_bytes());
        context.update(nonce);
        format!(
            "klf_whsec_{}",
            URL_SAFE_NO_PAD.encode(context.sign().as_ref())
        )
    }
}

pub(crate) fn signature(secret: &str, timestamp: &str, body: &[u8]) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    let mut context = hmac::Context::with_key(&key);
    context.update(timestamp.as_bytes());
    context.update(b".");
    context.update(body);
    let hex: String = context
        .sign()
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("v1={hex}")
}
