use super::signing::{SigningKey, signature};

#[test]
fn signs_exact_timestamp_and_raw_body() {
    let secret = "klf_whsec_fixture";
    let body = br#"{"version":1,"type":"webhook.test"}"#;
    assert_eq!(
        signature(secret, "1700000000", body),
        "v1=a400d457e48c8d72089db56a75156f449e0c478911f79becd5891d42090e1e03"
    );
    assert_ne!(
        signature(secret, "1700000000", body),
        signature(secret, "1700000001", body)
    );
    assert_ne!(
        signature(secret, "1700000000", body),
        signature(secret, "1700000000", b"{}")
    );
}

#[test]
fn derivation_separates_webhook_id_and_nonce() {
    let key = SigningKey::parse("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").unwrap();
    let workspace = uuid::Uuid::from_u128(1);
    let webhook = uuid::Uuid::from_u128(2);
    let secret = key.derive(workspace, webhook, &[3; 32]);
    assert!(secret.starts_with("klf_whsec_"));
    assert_ne!(
        secret,
        key.derive(workspace, uuid::Uuid::from_u128(4), &[3; 32])
    );
    assert_ne!(secret, key.derive(workspace, webhook, &[5; 32]));
    assert!(SigningKey::parse("not-a-key").is_err());
    assert!(
        !SigningKey::parse("my-secret-invalid")
            .err()
            .unwrap()
            .to_string()
            .contains("my-secret")
    );
}
