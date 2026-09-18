use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    time::Duration,
};

use chrono::Utc;
use reqwest::{Client, redirect::Policy};
use serde::Serialize;
use tokio::{
    net::lookup_host,
    time::{Instant, timeout},
};
use url::{Host, Url};
use uuid::Uuid;

use super::signing::signature;

#[derive(Clone)]
pub struct WebhookPolicy {
    pub allow_private_networks: bool,
    pub allow_http: bool,
    pub request_timeout: Duration,
}

impl Default for WebhookPolicy {
    fn default() -> Self {
        Self {
            allow_private_networks: false,
            allow_http: false,
            request_timeout: Duration::from_secs(10),
        }
    }
}

#[derive(Serialize)]
pub(crate) struct AttemptResult {
    pub success: bool,
    pub http_status: Option<u16>,
    pub duration_ms: i32,
    pub error: Option<&'static str>,
}

pub(crate) fn parse_endpoint(value: &str, policy: &WebhookPolicy) -> Result<Url, &'static str> {
    if value.len() > 2048 || value.chars().any(char::is_control) || value.contains('\\') {
        return Err("Endpoint URL is invalid");
    }
    let url = Url::parse(value).map_err(|_| "Endpoint URL is invalid")?;
    if !(url.scheme() == "https" || (url.scheme() == "http" && policy.allow_http)) {
        return Err("Endpoint must use HTTPS; HTTP requires instance permission");
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.host().is_none()
        || url.port() == Some(0)
    {
        return Err("Endpoint must have a valid host and no credentials or fragment");
    }
    match url.host() {
        Some(Host::Ipv4(address)) => {
            validate_addresses(&[SocketAddr::new(IpAddr::V4(address), 443)], policy)?
        }
        Some(Host::Ipv6(address)) => {
            validate_addresses(&[SocketAddr::new(IpAddr::V6(address), 443)], policy)?
        }
        Some(Host::Domain(host))
            if host.is_empty()
                || host.ends_with('.')
                || host.split('.').any(|label| {
                    label.is_empty()
                        || label.starts_with('-')
                        || label.ends_with('-')
                        || !label
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                }) =>
        {
            return Err("Endpoint hostname is invalid");
        }
        _ => {}
    }
    Ok(url)
}

fn public_ipv4(address: Ipv4Addr) -> bool {
    let value = u32::from(address);
    ![
        (0x00000000, 8),
        (0x0a000000, 8),
        (0x64400000, 10),
        (0x7f000000, 8),
        (0xa9fe0000, 16),
        (0xac100000, 12),
        (0xc0000000, 24),
        (0xc0000200, 24),
        (0xc0586300, 24),
        (0xc0a80000, 16),
        (0xc6120000, 15),
        (0xc6336400, 24),
        (0xcb007100, 24),
        (0xe0000000, 4),
        (0xf0000000, 4),
    ]
    .iter()
    .any(|(network, bits)| value >> (32 - bits) == network >> (32 - bits))
}

pub(crate) fn validate_addresses(
    addresses: &[SocketAddr],
    policy: &WebhookPolicy,
) -> Result<(), &'static str> {
    if addresses.is_empty() || addresses.len() > 64 {
        return Err("Endpoint DNS returned no usable destination");
    }
    for address in addresses {
        let ip = address.ip();
        let public = match ip {
            IpAddr::V4(ip) => public_ipv4(ip),
            IpAddr::V6(ip) => match ip.to_ipv4_mapped() {
                Some(ip) => public_ipv4(ip),
                None => {
                    let value = u128::from(ip);
                    value >> 125 == 1
                        && value >> 105 != 0x20010000000000000000000000000000u128 >> 105
                        && value >> 96 != 0x20010db8000000000000000000000000u128 >> 96
                        && value >> 112 != 0x2002
                        && value >> 108 != 0x3fff0000000000000000000000000000u128 >> 108
                }
            },
        };
        let invalid = ip.is_unspecified()
            || ip.is_multicast()
            || matches!(ip, IpAddr::V4(ip) if ip == Ipv4Addr::BROADCAST);
        if invalid || (!public && !policy.allow_private_networks) {
            return Err("Endpoint destination is blocked by instance network policy");
        }
    }
    Ok(())
}

async fn destination(url: &Url, policy: &WebhookPolicy) -> Result<Vec<SocketAddr>, &'static str> {
    let port = url
        .port_or_known_default()
        .ok_or("Endpoint port is invalid")?;
    let addresses = match url.host().ok_or("Endpoint hostname is invalid")? {
        Host::Ipv4(ip) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Host::Ipv6(ip) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        Host::Domain(host) => timeout(Duration::from_secs(3), lookup_host((host, port)))
            .await
            .map_err(|_| "Endpoint DNS timed out")?
            .map_err(|_| "Endpoint DNS lookup failed")?
            .take(65)
            .collect(),
    };
    validate_addresses(&addresses, policy)?;
    Ok(addresses)
}

pub(crate) async fn validate_endpoint(
    value: &str,
    policy: &WebhookPolicy,
) -> Result<Url, &'static str> {
    let url = parse_endpoint(value, policy)?;
    destination(&url, policy).await?;
    Ok(url)
}

pub(crate) async fn send(
    policy: &WebhookPolicy,
    endpoint: &str,
    secret: &str,
    event_type: &str,
    delivery: Uuid,
    body: &str,
) -> AttemptResult {
    // Select one provider explicitly; other TLS adapters may use local configs.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let started = Instant::now();
    let attempt = timeout(policy.request_timeout, async {
        let url = parse_endpoint(endpoint, policy)?;
        let addresses = destination(&url, policy).await?;
        let host = url.host_str().ok_or("Endpoint hostname is invalid")?;
        let client = Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(3))
            .timeout(policy.request_timeout)
            .http1_only()
            .resolve_to_addrs(host, &addresses)
            .build()
            .map_err(|_| "Webhook transport could not be initialized")?;
        let timestamp = Utc::now().timestamp().to_string();
        let response = client
            .post(url)
            .header("Content-Type", "application/json")
            .header("X-Kanleaf-Event", event_type)
            .header("X-Kanleaf-Delivery", delivery.to_string())
            .header("X-Kanleaf-Timestamp", &timestamp)
            .header(
                "X-Kanleaf-Signature",
                signature(secret, &timestamp, body.as_bytes()),
            )
            .body(body.to_owned())
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    "Endpoint request timed out"
                } else {
                    "Endpoint connection failed"
                }
            })?;
        // Dropping the response avoids retaining or trusting receiver bodies/headers.
        Ok::<_, &'static str>(response.status().as_u16())
    })
    .await;
    let (status, error) = match attempt {
        Ok(Ok(status)) if (200..300).contains(&status) => (Some(status), None),
        Ok(Ok(status)) if !(100..600).contains(&status) => {
            (None, Some("Endpoint returned an invalid HTTP status"))
        }
        Ok(Ok(status)) => (
            Some(status),
            Some("Endpoint returned a non-success HTTP status"),
        ),
        Ok(Err(error)) => (None, Some(error)),
        Err(_) => (None, Some("Endpoint request timed out")),
    };
    AttemptResult {
        success: error.is_none(),
        http_status: status,
        duration_ms: started.elapsed().as_millis().min(i32::MAX as u128) as i32,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_non_public_destinations_and_mixed_dns_answers() {
        for ip in [
            "0.0.0.0",
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.2",
            "169.254.169.254",
            "100.64.1.1",
            "224.0.0.1",
            "240.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
            "2002:7f00:1::1",
        ] {
            assert!(
                validate_addresses(
                    &[SocketAddr::new(ip.parse().unwrap(), 443)],
                    &WebhookPolicy::default()
                )
                .is_err(),
                "{ip}"
            );
        }
        assert!(
            validate_addresses(
                &[
                    "8.8.8.8:443".parse().unwrap(),
                    "127.0.0.1:443".parse().unwrap()
                ],
                &WebhookPolicy::default()
            )
            .is_err()
        );
        assert!(
            validate_addresses(
                &[
                    "8.8.8.8:443".parse().unwrap(),
                    "[2606:4700:4700::1111]:443".parse().unwrap()
                ],
                &WebhookPolicy::default()
            )
            .is_ok()
        );
    }
    #[test]
    fn explicit_network_permission_does_not_accept_unsafe_urls() {
        let policy = WebhookPolicy {
            allow_private_networks: true,
            allow_http: true,
            ..Default::default()
        };
        assert!(parse_endpoint("http://127.0.0.1/receive", &policy).is_ok());
        for url in [
            "ftp://example.com",
            "https://user:password@example.com",
            "https://example.com/#fragment",
            "http://0.0.0.0",
            "https://example.com:0",
            "https://bad_host.example",
        ] {
            assert!(parse_endpoint(url, &policy).is_err(), "{url}");
        }
        assert!(parse_endpoint("http://example.com", &WebhookPolicy::default()).is_err());
    }
    #[tokio::test]
    async fn dns_cannot_hide_a_loopback_address() {
        assert!(
            validate_endpoint("https://localhost/receive", &WebhookPolicy::default())
                .await
                .is_err()
        );
    }
}
