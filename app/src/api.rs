use gloo_net::http::{Request, Response};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

const API_BASE_URL: &str = "http://127.0.0.1:3000";

#[derive(Deserialize)]
struct ApiErrorResponse {
    message: String,
}

pub async fn get_json<R>(path: &str, token: &str) -> Result<R, String>
where
    R: DeserializeOwned,
{
    let response = Request::get(&url(path))
        .header("Authorization", &format!("Bearer {token}"))
        .send()
        .await
        .map_err(|_| "Could not reach the Kanleaf backend.".to_owned())?;
    decode(response).await
}

pub async fn post_json<T, R>(path: &str, token: Option<&str>, body: &T) -> Result<R, String>
where
    T: Serialize + ?Sized,
    R: DeserializeOwned,
{
    let mut request = Request::post(&url(path));
    if let Some(token) = token {
        request = request.header("Authorization", &format!("Bearer {token}"));
    }
    let response = request
        .json(body)
        .map_err(|_| "Could not prepare the request.".to_owned())?
        .send()
        .await
        .map_err(|_| "Could not reach the Kanleaf backend.".to_owned())?;
    decode(response).await
}

async fn decode<R>(response: Response) -> Result<R, String>
where
    R: DeserializeOwned,
{
    if response.ok() {
        response
            .json::<R>()
            .await
            .map_err(|_| "The backend returned an invalid response.".to_owned())
    } else {
        let fallback = format!("The request failed with status {}.", response.status());
        Err(response
            .json::<ApiErrorResponse>()
            .await
            .map(|error| error.message)
            .unwrap_or(fallback))
    }
}

fn url(path: &str) -> String {
    format!("{API_BASE_URL}{path}")
}
