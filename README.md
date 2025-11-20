# OAuth2 Middleware for TimeTonic Automations

This middleware acts as a proxy to connect simple authentication clients (like TimeTonic automations) to OAuth2-protected APIs. It handles the OAuth2 Client Credentials flow, managing token retrieval and refreshing automatically.

We provide two implementations:
- **Node.js** (Express)
- **Python** (FastAPI)

## Features

- **Automatic OAuth2 Auth**: Handles `client_credentials` grant flow.
- **Token Caching**: Caches access tokens until they expire to minimize overhead.
- **Transparent Proxying**: Forwards all requests (method, headers, body) to the target API.
- **Security**: Optional `INCOMING_BEARER_TOKEN` to restrict access to the middleware.

## Configuration

1.  Copy `.env.example` to `.env`:
    ```bash
    cp .env.example .env
    ```
2.  Edit `.env` with your API credentials:
    - `OAUTH_CLIENT_ID`: Your OAuth2 Client ID.
    - `OAUTH_CLIENT_SECRET`: Your OAuth2 Client Secret.
    - `OAUTH_TOKEN_URL`: The URL to fetch the access token (e.g., `https://api.acme.com/oauth/token`).
    - `TARGET_API_BASE_URL`: The base URL of the API you want to access (e.g., `https://api.acme.com`).
    - `INCOMING_BEARER_TOKEN`: (Optional) A secret token you define. If set, you must send this token in the `Authorization` header when calling the middleware.

## Running with Docker Compose

To run both services (Node.js on port 3000, Python on port 8000):

```bash
docker-compose up --build
```

## Usage

Assuming the middleware is running on `https://middleware.timetonic.com` (or `http://localhost:3000` locally):

If you want to call `https://api.acme.com/orders/123`:

**Request to Middleware:**
```http
GET /orders/123 HTTP/1.1
Host: middleware.timetonic.com
Authorization: Bearer <INCOMING_BEARER_TOKEN>  <-- Only if configured
```

**What happens internally:**
1.  Middleware checks `INCOMING_BEARER_TOKEN` (if configured).
2.  Middleware gets an OAuth2 access token from `OAUTH_TOKEN_URL` (using Client ID/Secret).
3.  Middleware forwards the request to `https://api.acme.com/orders/123` with `Authorization: Bearer <oauth_access_token>`.
4.  Middleware returns the response from the API.

## Development

### Node.js
```bash
cd node
npm install
npm start
```

### Python
```bash
cd python
pip install -r requirements.txt
python main.py
```