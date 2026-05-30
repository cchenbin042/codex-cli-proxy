// proxy/src/main.rs
mod config;
mod converter;
mod providers;
mod reliability;
mod cache;
mod audit;
mod store;
mod logger;
mod tracer;

use axum::{routing::get, Router};
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    logger::init();
    let config = config::load_from_env();

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/responses", axum::routing::post(handle_responses))
        .with_state(config);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("proxy listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
    "{\"status\": \"ok\"}"
}

// handler stub
async fn handle_responses() -> &'static str {
    "not yet implemented"
}
